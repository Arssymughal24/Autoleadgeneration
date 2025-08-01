import { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger";
import * as stats from "simple-statistics";

const prisma = new PrismaClient();

export interface AbTestConfiguration {
  name: string;
  description?: string;
  campaignId?: string;
  testType: string;
  variants: {
    name: string;
    content: any;
    trafficPercent: number;
  }[];
  confidenceLevel: number;
  minSampleSize: number;
}

export interface AbTestResults {
  testId: string;
  status: string;
  variants: {
    id: string;
    name: string;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    conversionRate: number;
    revenuePerConversion: number;
    confidence?: {
      lower: number;
      upper: number;
    };
  }[];
  winner?: {
    variantId: string;
    variantName: string;
    significance: number;
    improvement: number;
  };
  statisticalSignificance?: number;
  recommendedAction?: string;
  startDate?: Date;
  endDate?: Date;
}

export class AbTestingService {
  async createAbTest(config: AbTestConfiguration): Promise<string> {
    try {
      // Validate traffic split adds up to 100%
      const totalTraffic = config.variants.reduce((sum, v) => sum + v.trafficPercent, 0);
      if (Math.abs(totalTraffic - 100) > 0.01) {
        throw new Error("Variant traffic percentages must add up to 100%");
      }

      const abTest = await prisma.abTest.create({
        data: {
          name: config.name,
          description: config.description,
          campaignId: config.campaignId,
          testType: config.testType as any,
          trafficSplit: config.variants.reduce((split, variant) => {
            split[variant.name] = variant.trafficPercent;
            return split;
          }, {} as any),
          confidenceLevel: config.confidenceLevel,
          minSampleSize: config.minSampleSize,
          variants: {
            create: config.variants.map(variant => ({
              name: variant.name,
              content: variant.content,
              trafficPercent: variant.trafficPercent,
            })),
          },
        },
        include: {
          variants: true,
        },
      });

      logger.info(`A/B test created: ${abTest.name} (${abTest.id})`);
      return abTest.id;

    } catch (error) {
      logger.error("Error creating A/B test:", error);
      throw error;
    }
  }

  async startAbTest(testId: string): Promise<void> {
    try {
      await prisma.abTest.update({
        where: { id: testId },
        data: {
          status: "RUNNING",
          startDate: new Date(),
        },
      });

      logger.info(`A/B test started: ${testId}`);

    } catch (error) {
      logger.error(`Error starting A/B test ${testId}:`, error);
      throw error;
    }
  }

  async assignVariant(testId: string, leadId: string): Promise<string> {
    try {
      const test = await prisma.abTest.findUnique({
        where: { id: testId },
        include: { variants: true },
      });

      if (!test || test.status !== "RUNNING") {
        throw new Error("Test is not running");
      }

      // Check if lead is already assigned
      const existingAssignment = await prisma.abTestResult.findFirst({
        where: {
          testId,
          leadId,
          event: "ASSIGNED",
        },
      });

      if (existingAssignment) {
        return existingAssignment.variantId;
      }

      // Assign variant based on traffic split
      const random = Math.random() * 100;
      let cumulative = 0;
      let selectedVariant = test.variants[0];

      for (const variant of test.variants) {
        cumulative += variant.trafficPercent;
        if (random <= cumulative) {
          selectedVariant = variant;
          break;
        }
      }

      // Record assignment
      await prisma.abTestResult.create({
        data: {
          testId,
          variantId: selectedVariant.id,
          leadId,
          event: "ASSIGNED",
        },
      });

      // Log activity
      await prisma.activity.create({
        data: {
          leadId,
          type: "AB_TEST_ASSIGNED",
          description: `Assigned to A/B test variant: ${selectedVariant.name}`,
          metadata: {
            testId,
            variantId: selectedVariant.id,
            variantName: selectedVariant.name,
          },
        },
      });

      return selectedVariant.id;

    } catch (error) {
      logger.error(`Error assigning variant for test ${testId}:`, error);
      throw error;
    }
  }

  async trackEvent(testId: string, variantId: string, leadId: string, event: string, value?: number): Promise<void> {
    try {
      await prisma.abTestResult.create({
        data: {
          testId,
          variantId,
          leadId,
          event: event as any,
          value,
        },
      });

      // Update variant metrics
      const updateData: any = {};
      switch (event) {
        case "IMPRESSION":
          updateData.impressions = { increment: 1 };
          break;
        case "CLICK":
          updateData.clicks = { increment: 1 };
          break;
        case "CONVERSION":
          updateData.conversions = { increment: 1 };
          break;
        case "REVENUE":
          updateData.revenue = { increment: value || 0 };
          break;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.abTestVariant.update({
          where: { id: variantId },
          data: updateData,
        });
      }

      logger.debug(`A/B test event tracked: ${event} for variant ${variantId}`);

    } catch (error) {
      logger.error(`Error tracking A/B test event:`, error);
      throw error;
    }
  }

  async getTestResults(testId: string): Promise<AbTestResults> {
    try {
      const test = await prisma.abTest.findUnique({
        where: { id: testId },
        include: {
          variants: true,
          results: true,
        },
      });

      if (!test) {
        throw new Error("Test not found");
      }

      const variantResults = test.variants.map(variant => {
        const conversionRate = variant.impressions > 0 ? (variant.conversions / variant.impressions) * 100 : 0;
        const revenuePerConversion = variant.conversions > 0 ? variant.revenue / variant.conversions : 0;

        return {
          id: variant.id,
          name: variant.name,
          impressions: variant.impressions,
          clicks: variant.clicks,
          conversions: variant.conversions,
          revenue: variant.revenue,
          conversionRate: Math.round(conversionRate * 100) / 100,
          revenuePerConversion: Math.round(revenuePerConversion * 100) / 100,
        };
      });

      // Calculate statistical significance
      const results: AbTestResults = {
        testId: test.id,
        status: test.status,
        variants: variantResults,
        startDate: test.startDate || undefined,
        endDate: test.endDate || undefined,
      };

      // Perform statistical analysis if we have enough data
      if (variantResults.length >= 2 && variantResults.every(v => v.impressions >= test.minSampleSize)) {
        const analysis = this.performStatisticalAnalysis(variantResults, test.confidenceLevel);
        results.statisticalSignificance = analysis.significance;
        results.winner = analysis.winner;
        results.recommendedAction = analysis.recommendation;

        // Add confidence intervals
        results.variants = variantResults.map(variant => ({
          ...variant,
          confidence: this.calculateConfidenceInterval(
            variant.conversions,
            variant.impressions,
            test.confidenceLevel
          ),
        }));
      }

      return results;

    } catch (error) {
      logger.error(`Error getting test results for ${testId}:`, error);
      throw error;
    }
  }

  async concludeTest(testId: string): Promise<AbTestResults> {
    try {
      const results = await this.getTestResults(testId);

      await prisma.abTest.update({
        where: { id: testId },
        data: {
          status: "COMPLETED",
          endDate: new Date(),
          winningVariant: results.winner?.variantId,
          significance: results.statisticalSignificance,
        },
      });

      logger.info(`A/B test concluded: ${testId}, winner: ${results.winner?.variantName || "No clear winner"}`);
      return results;

    } catch (error) {
      logger.error(`Error concluding test ${testId}:`, error);
      throw error;
    }
  }

  async getActiveTests(): Promise<any[]> {
    try {
      const tests = await prisma.abTest.findMany({
        where: { status: "RUNNING" },
        include: {
          variants: true,
          campaign: true,
          _count: {
            select: { results: true },
          },
        },
        orderBy: { startDate: "desc" },
      });

      return tests.map(test => ({
        id: test.id,
        name: test.name,
        type: test.testType,
        campaignName: test.campaign?.name,
        variantCount: test.variants.length,
        totalEvents: test._count.results,
        startDate: test.startDate,
        status: test.status,
      }));

    } catch (error) {
      logger.error("Error getting active tests:", error);
      throw error;
    }
  }

  private performStatisticalAnalysis(variants: any[], confidenceLevel: number): {
    significance: number;
    winner?: { variantId: string; variantName: string; improvement: number };
    recommendation: string;
  } {
    try {
      if (variants.length !== 2) {
        return { significance: 0, recommendation: "Statistical analysis only supported for 2-variant tests" };
      }

      const [control, treatment] = variants;
      
      // Z-test for difference in conversion rates
      const p1 = control.conversions / control.impressions;
      const p2 = treatment.conversions / treatment.impressions;
      
      const pooledP = (control.conversions + treatment.conversions) / (control.impressions + treatment.impressions);
      const se = Math.sqrt(pooledP * (1 - pooledP) * (1/control.impressions + 1/treatment.impressions));
      
      const zScore = Math.abs(p2 - p1) / se;
      const pValue = 2 * (1 - stats.cumulativeStdNormalProbability(Math.abs(zScore)));
      
      const significance = (1 - pValue) * 100;
      const requiredSignificance = confidenceLevel;
      
      let winner;
      let recommendation = "Continue test - not enough data for conclusive results";
      
      if (significance >= requiredSignificance) {
        const betterVariant = p2 > p1 ? treatment : control;
        const improvement = Math.abs((p2 - p1) / p1) * 100;
        
        winner = {
          variantId: betterVariant.id,
          variantName: betterVariant.name,
          improvement: Math.round(improvement * 100) / 100,
        };
        
        recommendation = `${betterVariant.name} is significantly better. Implement this variant.`;
      } else if (significance >= 80) {
        recommendation = "Test showing promising results but needs more data";
      }

      return {
        significance: Math.round(significance * 100) / 100,
        winner,
        recommendation,
      };

    } catch (error) {
      logger.error("Error in statistical analysis:", error);
      return { significance: 0, recommendation: "Error in statistical analysis" };
    }
  }

  private calculateConfidenceInterval(conversions: number, impressions: number, confidenceLevel: number): {
    lower: number;
    upper: number;
  } {
    if (impressions === 0) {
      return { lower: 0, upper: 0 };
    }

    const p = conversions / impressions;
    const z = stats.probit((1 + confidenceLevel / 100) / 2);
    const margin = z * Math.sqrt((p * (1 - p)) / impressions);

    return {
      lower: Math.max(0, Math.round((p - margin) * 10000) / 100),
      upper: Math.min(100, Math.round((p + margin) * 10000) / 100),
    };
  }
}

export const abTestingService = new AbTestingService();
