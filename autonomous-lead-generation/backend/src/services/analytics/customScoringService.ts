import { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger";

const prisma = new PrismaClient();

export interface ScoringAlgorithmConfig {
  name: string;
  description?: string;
  version?: string;
  algorithm: {
    type: "weighted_sum" | "decision_tree" | "logistic_regression" | "neural_network";
    features: string[];
    implementation: any;
  };
  weights: Record<string, number>;
  thresholds: {
    hot: number;
    warm: number;
    cold: number;
  };
}

export interface LeadFeatures {
  // Company features
  companySize?: number;
  industryScore?: number;
  revenueEstimate?: number;
  techStack?: string[];
  
  // Contact features
  seniorityLevel?: number;
  departmentRelevance?: number;
  contactQuality?: number;
  
  // Engagement features
  emailEngagement?: number;
  websiteVisits?: number;
  contentDownloads?: number;
  socialEngagement?: number;
  
  // Behavioral features
  responseTime?: number;
  questionQuality?: number;
  buyingIntent?: number;
  
  // Historical features
  pastConversions?: number;
  campaignInteractions?: number;
  formSubmissions?: number;
}

export interface ScoringResult {
  score: number;
  confidence: number;
  category: "hot" | "warm" | "cold";
  features: LeadFeatures;
  explanation: {
    topFactors: Array<{
      feature: string;
      impact: number;
      value: any;
    }>;
    reasoning: string;
  };
}

export class CustomScoringService {
  async createScoringAlgorithm(config: ScoringAlgorithmConfig): Promise<string> {
    try {
      const algorithm = await prisma.scoringAlgorithm.create({
        data: {
          name: config.name,
          description: config.description,
          version: config.version || "1.0",
          algorithm: config.algorithm,
          weights: config.weights,
          thresholds: config.thresholds,
        },
      });

      logger.info(`Scoring algorithm created: ${algorithm.name} (${algorithm.id})`);
      return algorithm.id;

    } catch (error) {
      logger.error("Error creating scoring algorithm:", error);
      throw error;
    }
  }

  async scoreLeadWithAlgorithm(leadId: string, algorithmId: string): Promise<ScoringResult> {
    try {
      const [lead, algorithm] = await Promise.all([
        prisma.lead.findUnique({
          where: { id: leadId },
          include: {
            activities: true,
            campaigns: true,
            formSubmission: true,
          },
        }),
        prisma.scoringAlgorithm.findUnique({
          where: { id: algorithmId },
        }),
      ]);

      if (!lead || !algorithm) {
        throw new Error("Lead or algorithm not found");
      }

      const features = await this.extractLeadFeatures(lead);
      const result = this.applyAlgorithm(features, algorithm);

      // Store result
      await prisma.scoringResult.upsert({
        where: {
          leadId_algorithmId: {
            leadId,
            algorithmId,
          },
        },
        update: {
          score: result.score,
          confidence: result.confidence,
          features: features,
          explanation: result.explanation,
        },
        create: {
          leadId,
          algorithmId,
          score: result.score,
          confidence: result.confidence,
          features: features,
          explanation: result.explanation,
        },
      });

      // Log activity
      await prisma.activity.create({
        data: {
          leadId,
          type: "CUSTOM_SCORE_CALCULATED",
          description: `Custom score calculated: ${result.score}/100 (${algorithm.name})`,
          metadata: {
            algorithmId,
            algorithmName: algorithm.name,
            score: result.score,
            category: result.category,
          },
        },
      });

      logger.info(`Lead ${leadId} scored with ${algorithm.name}: ${result.score}/100`);
      return result;

    } catch (error) {
      logger.error(`Error scoring lead ${leadId} with algorithm ${algorithmId}:`, error);
      throw error;
    }
  }

  async batchScoreLeads(leadIds: string[], algorithmId: string): Promise<Map<string, ScoringResult>> {
    const results = new Map<string, ScoringResult>();
    
    for (const leadId of leadIds) {
      try {
        const result = await this.scoreLeadWithAlgorithm(leadId, algorithmId);
        results.set(leadId, result);
      } catch (error) {
        logger.error(`Failed to score lead ${leadId}:`, error);
      }
    }
    
    return results;
  }

  async getScoringAlgorithms(): Promise<any[]> {
    try {
      const algorithms = await prisma.scoringAlgorithm.findMany({
        where: { isActive: true },
        include: {
          _count: {
            select: { scoringResults: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return algorithms.map(alg => ({
        id: alg.id,
        name: alg.name,
        description: alg.description,
        version: alg.version,
        type: alg.algorithm.type,
        leadsScored: alg._count.scoringResults,
        accuracy: alg.accuracy,
        createdAt: alg.createdAt,
      }));

    } catch (error) {
      logger.error("Error getting scoring algorithms:", error);
      throw error;
    }
  }

  async getLeadScores(leadId: string): Promise<any[]> {
    try {
      const scores = await prisma.scoringResult.findMany({
        where: { leadId },
        include: {
          algorithm: {
            select: {
              id: true,
              name: true,
              version: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return scores.map(score => ({
        algorithmId: score.algorithm.id,
        algorithmName: score.algorithm.name,
        algorithmVersion: score.algorithm.version,
        score: score.score,
        confidence: score.confidence,
        category: this.getScoreCategory(score.score, score.algorithm.id),
        createdAt: score.createdAt,
        explanation: score.explanation,
      }));

    } catch (error) {
      logger.error(`Error getting scores for lead ${leadId}:`, error);
      throw error;
    }
  }

  async updateAlgorithmPerformance(algorithmId: string, performance: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1Score?: number;
  }): Promise<void> {
    try {
      await prisma.scoringAlgorithm.update({
        where: { id: algorithmId },
        data: performance,
      });

      logger.info(`Algorithm performance updated: ${algorithmId}`);

    } catch (error) {
      logger.error(`Error updating algorithm performance:`, error);
      throw error;
    }
  }

  private async extractLeadFeatures(lead: any): Promise<LeadFeatures> {
    const features: LeadFeatures = {};

    // Company features
    if (lead.enrichedData?.companyInfo) {
      const company = lead.enrichedData.companyInfo;
      features.companySize = this.normalizeCompanySize(company.employeeCount);
      features.industryScore = this.getIndustryScore(lead.industry);
      features.revenueEstimate = this.normalizeRevenue(company.revenue);
      features.techStack = company.technologies || [];
    }

    // Contact features
    features.seniorityLevel = this.getSeniorityLevel(lead.jobTitle);
    features.departmentRelevance = this.getDepartmentRelevance(lead.jobTitle);
    features.contactQuality = this.assessContactQuality(lead);

    // Engagement features
    const engagementData = await this.calculateEngagementMetrics(lead.id);
    features.emailEngagement = engagementData.emailEngagement;
    features.websiteVisits = engagementData.websiteVisits;
    features.contentDownloads = engagementData.contentDownloads;

    // Behavioral features
    features.responseTime = this.calculateResponseTime(lead.activities);
    features.buyingIntent = this.assessBuyingIntent(lead);

    // Historical features
    features.campaignInteractions = lead.campaigns.length;
    features.formSubmissions = lead.formSubmission ? 1 : 0;

    return features;
  }

  private applyAlgorithm(features: LeadFeatures, algorithm: any): ScoringResult {
    const weights = algorithm.weights;
    const thresholds = algorithm.thresholds;

    let totalScore = 0;
    let totalWeight = 0;
    const impacts: Array<{ feature: string; impact: number; value: any }> = [];

    // Calculate weighted sum
    Object.entries(features).forEach(([feature, value]) => {
      if (weights[feature] && value !== undefined && value !== null) {
        const normalizedValue = this.normalizeFeatureValue(value);
        const weight = weights[feature];
        const impact = normalizedValue * weight;
        
        totalScore += impact;
        totalWeight += weight;
        
        impacts.push({
          feature,
          impact: Math.round(impact * 100) / 100,
          value,
        });
      }
    });

    // Normalize to 0-100 scale
    const finalScore = totalWeight > 0 ? (totalScore / totalWeight) * 100 : 0;

    // Determine category
    let category: "hot" | "warm" | "cold";
    if (finalScore >= thresholds.hot) {
      category = "hot";
    } else if (finalScore >= thresholds.warm) {
      category = "warm";
    } else {
      category = "cold";
    }

    // Sort impacts by absolute value
    impacts.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

    // Calculate confidence based on data completeness
    const featureCompleteness = Object.values(features).filter(v => v !== undefined && v !== null).length / Object.keys(weights).length;
    const confidence = Math.min(1, featureCompleteness * 1.2);

    return {
      score: Math.round(finalScore * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      category,
      features,
      explanation: {
        topFactors: impacts.slice(0, 5),
        reasoning: this.generateReasoning(finalScore, category, impacts.slice(0, 3)),
      },
    };
  }

  private normalizeFeatureValue(value: any): number {
    if (typeof value === "number") {
      return Math.min(1, Math.max(0, value / 100));
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (Array.isArray(value)) {
      return Math.min(1, value.length / 10);
    }
    return 0;
  }

  private normalizeCompanySize(employeeCount?: number): number {
    if (!employeeCount) return 0;
    
    // Score based on company size (higher score for larger companies)
    if (employeeCount >= 1000) return 100;
    if (employeeCount >= 500) return 85;
    if (employeeCount >= 200) return 70;
    if (employeeCount >= 50) return 55;
    if (employeeCount >= 10) return 40;
    return 25;
  }

  private getIndustryScore(industry?: string): number {
    if (!industry) return 50;
    
    // High-value industries
    const highValue = ["software", "saas", "technology", "fintech", "healthcare", "finance"];
    const mediumValue = ["retail", "manufacturing", "consulting", "marketing", "education"];
    
    const industryLower = industry.toLowerCase();
    
    if (highValue.some(hv => industryLower.includes(hv))) return 90;
    if (mediumValue.some(mv => industryLower.includes(mv))) return 70;
    return 50;
  }

  private getSeniorityLevel(jobTitle?: string): number {
    if (!jobTitle) return 50;
    
    const title = jobTitle.toLowerCase();
    
    if (title.includes("ceo") || title.includes("founder") || title.includes("president")) return 100;
    if (title.includes("vp") || title.includes("vice president")) return 90;
    if (title.includes("director")) return 80;
    if (title.includes("manager") || title.includes("head")) return 70;
    if (title.includes("lead") || title.includes("senior")) return 60;
    return 40;
  }

  private getDepartmentRelevance(jobTitle?: string): number {
    if (!jobTitle) return 50;
    
    const title = jobTitle.toLowerCase();
    
    // High relevance for decision-making roles
    if (title.includes("marketing") || title.includes("sales") || title.includes("business")) return 90;
    if (title.includes("operations") || title.includes("strategy")) return 80;
    if (title.includes("product") || title.includes("technology")) return 70;
    return 50;
  }

  private assessContactQuality(lead: any): number {
    let quality = 50;
    
    // Email domain quality
    if (lead.email && !lead.email.includes("gmail") && !lead.email.includes("yahoo")) {
      quality += 20;
    }
    
    // LinkedIn profile
    if (lead.linkedinUrl) {
      quality += 15;
    }
    
    // Company website
    if (lead.website) {
      quality += 10;
    }
    
    // Phone number
    if (lead.phone) {
      quality += 5;
    }
    
    return Math.min(100, quality);
  }

  private async calculateEngagementMetrics(leadId: string): Promise<{
    emailEngagement: number;
    websiteVisits: number;
    contentDownloads: number;
  }> {
    // This would integrate with email tracking and website analytics
    // For now, return placeholder values
    return {
      emailEngagement: 50,
      websiteVisits: 0,
      contentDownloads: 0,
    };
  }

  private calculateResponseTime(activities: any[]): number {
    // Calculate average response time from activities
    // For now, return placeholder
    return 50;
  }

  private assessBuyingIntent(lead: any): number {
    let intent = 30; // Base intent
    
    // Form submission indicates higher intent
    if (lead.formSubmission) {
      intent += 40;
    }
    
    // Multiple campaign interactions
    if (lead.campaigns.length > 2) {
      intent += 20;
    }
    
    // Recent activities
    const recentActivities = lead.activities.filter((a: any) => 
      new Date(a.createdAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    
    intent += Math.min(30, recentActivities.length * 5);
    
    return Math.min(100, intent);
  }

  private generateReasoning(score: number, category: string, topFactors: any[]): string {
    let reasoning = `Lead scored ${score}/100, categorized as ${category}. `;
    
    if (topFactors.length > 0) {
      reasoning += "Key factors: ";
      reasoning += topFactors.map(f => `${f.feature} (${f.impact > 0 ? '+' : ''}${f.impact})`).join(", ");
    }
    
    if (category === "hot") {
      reasoning += ". High-priority lead - immediate outreach recommended.";
    } else if (category === "warm") {
      reasoning += ". Moderate-priority lead - targeted nurturing recommended.";
    } else {
      reasoning += ". Low-priority lead - automated nurturing or disqualification.";
    }
    
    return reasoning;
  }

  private async getScoreCategory(score: number, algorithmId: string): Promise<string> {
    const algorithm = await prisma.scoringAlgorithm.findUnique({
      where: { id: algorithmId },
      select: { thresholds: true },
    });
    
    if (!algorithm) return "unknown";
    
    const thresholds = algorithm.thresholds as any;
    
    if (score >= thresholds.hot) return "hot";
    if (score >= thresholds.warm) return "warm";
    return "cold";
  }
}

export const customScoringService = new CustomScoringService();
