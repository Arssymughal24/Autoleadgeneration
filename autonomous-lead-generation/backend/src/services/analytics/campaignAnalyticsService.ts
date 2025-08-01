import { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger";

const prisma = new PrismaClient();

export interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  type: string;
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  totalBounced: number;
  totalUnsubscribed: number;
  totalConverted: number;
  totalRevenue: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
  unsubscribeRate: number;
  conversionRate: number;
  averageRevenuePerLead: number;
  createdAt: Date;
  lastUpdated: Date;
}

export interface DashboardMetrics {
  overview: {
    totalLeads: number;
    totalCampaigns: number;
    totalRevenue: number;
    averageScore: number;
    conversionRate: number;
    activeLeads: number;
  };
  campaignPerformance: CampaignMetrics[];
  leadSources: {
    source: string;
    count: number;
    percentage: number;
    conversionRate: number;
  }[];
  trends: {
    date: string;
    leads: number;
    revenue: number;
    conversions: number;
  }[];
}

export class CampaignAnalyticsService {
  async calculateCampaignMetrics(campaignId: string): Promise<CampaignMetrics> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          executions: {
            include: {
              emailEvents: true,
            },
          },
        },
      });

      if (!campaign) {
        throw new Error("Campaign not found");
      }

      const executions = campaign.executions;
      const totalSent = executions.length;

      // Calculate basic metrics
      const totalDelivered = executions.filter(e => e.status !== "FAILED" && e.status !== "BOUNCED").length;
      const totalOpened = executions.filter(e => e.openedAt).length;
      const totalClicked = executions.filter(e => e.clickedAt).length;
      const totalReplied = executions.filter(e => e.repliedAt).length;
      const totalBounced = executions.filter(e => e.status === "BOUNCED").length;
      const totalConverted = executions.filter(e => e.convertedAt && e.revenue && e.revenue > 0).length;

      // Calculate unsubscribes from email events
      const totalUnsubscribed = executions.reduce((count, execution) => {
        return count + execution.emailEvents.filter(event => event.eventType === "UNSUBSCRIBED").length;
      }, 0);

      // Calculate revenue
      const totalRevenue = executions.reduce((sum, execution) => {
        return sum + (execution.revenue || 0);
      }, 0);

      // Calculate rates (handle division by zero)
      const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;
      const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
      const clickRate = totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0;
      const replyRate = totalDelivered > 0 ? (totalReplied / totalDelivered) * 100 : 0;
      const bounceRate = totalSent > 0 ? (totalBounced / totalSent) * 100 : 0;
      const unsubscribeRate = totalDelivered > 0 ? (totalUnsubscribed / totalDelivered) * 100 : 0;
      const conversionRate = totalDelivered > 0 ? (totalConverted / totalDelivered) * 100 : 0;
      const averageRevenuePerLead = totalConverted > 0 ? totalRevenue / totalConverted : 0;

      const metrics: CampaignMetrics = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        type: campaign.type,
        totalSent,
        totalDelivered,
        totalOpened,
        totalClicked,
        totalReplied,
        totalBounced,
        totalUnsubscribed,
        totalConverted,
        totalRevenue,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        openRate: Math.round(openRate * 100) / 100,
        clickRate: Math.round(clickRate * 100) / 100,
        replyRate: Math.round(replyRate * 100) / 100,
        bounceRate: Math.round(bounceRate * 100) / 100,
        unsubscribeRate: Math.round(unsubscribeRate * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        averageRevenuePerLead: Math.round(averageRevenuePerLead * 100) / 100,
        createdAt: campaign.createdAt,
        lastUpdated: new Date(),
      };

      // Store analytics in database
      await this.storeCampaignAnalytics(metrics);

      logger.info(`Campaign metrics calculated for ${campaignId}: ${totalSent} sent, ${openRate}% open rate`);
      return metrics;

    } catch (error) {
      logger.error(`Error calculating campaign metrics for ${campaignId}:`, error);
      throw error;
    }
  }

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    try {
      // Overview metrics
      const [totalLeads, totalCampaigns, revenueResult, averageScoreResult, activeLeads] = await Promise.all([
        prisma.lead.count(),
        prisma.campaign.count(),
        prisma.campaignExecution.aggregate({
          _sum: { revenue: true },
        }),
        prisma.lead.aggregate({
          _avg: { score: true },
        }),
        prisma.lead.count({
          where: {
            status: {
              in: ["CAMPAIGN_ACTIVE", "QUALIFIED", "SCORED"],
            },
          },
        }),
      ]);

      const totalRevenue = revenueResult._sum.revenue || 0;
      const averageScore = averageScoreResult._avg.score || 0;

      // Calculate overall conversion rate
      const totalConversions = await prisma.campaignExecution.count({
        where: {
          convertedAt: { not: null },
          revenue: { gt: 0 },
        },
      });
      const conversionRate = totalLeads > 0 ? (totalConversions / totalLeads) * 100 : 0;

      // Campaign performance
      const campaigns = await prisma.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      const campaignPerformance = await Promise.all(
        campaigns.map(campaign => this.calculateCampaignMetrics(campaign.id))
      );

      // Lead sources analysis
      const leadSourcesData = await prisma.lead.groupBy({
        by: ["source"],
        _count: { source: true },
      });

      const leadSources = await Promise.all(
        leadSourcesData.map(async (source) => {
          const conversions = await prisma.campaignExecution.count({
            where: {
              lead: { source: source.source },
              convertedAt: { not: null },
              revenue: { gt: 0 },
            },
          });

          return {
            source: source.source,
            count: source._count.source,
            percentage: Math.round((source._count.source / totalLeads) * 100 * 100) / 100,
            conversionRate: source._count.source > 0 ? Math.round((conversions / source._count.source) * 100 * 100) / 100 : 0,
          };
        })
      );

      // Trends for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const trendsData = await prisma.$queryRaw<Array<{
        date: string;
        leads: bigint;
        revenue: number;
        conversions: bigint;
      }>>`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as leads,
          COALESCE(SUM(CASE WHEN revenue > 0 THEN revenue ELSE 0 END), 0) as revenue,
          COUNT(CASE WHEN revenue > 0 THEN 1 END) as conversions
        FROM leads l
        LEFT JOIN campaign_executions ce ON l.id = ce.lead_id
        WHERE l.created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(l.created_at)
        ORDER BY DATE(l.created_at)
      `;

      const trends = trendsData.map(row => ({
        date: row.date,
        leads: Number(row.leads),
        revenue: row.revenue,
        conversions: Number(row.conversions),
      }));

      return {
        overview: {
          totalLeads,
          totalCampaigns,
          totalRevenue,
          averageScore: Math.round(averageScore * 100) / 100,
          conversionRate: Math.round(conversionRate * 100) / 100,
          activeLeads,
        },
        campaignPerformance,
        leadSources,
        trends,
      };

    } catch (error) {
      logger.error("Error calculating dashboard metrics:", error);
      throw error;
    }
  }

  async trackEmailEvent(executionId: string, eventType: string, metadata?: any): Promise<void> {
    try {
      await prisma.emailEvent.create({
        data: {
          executionId,
          eventType: eventType as any,
          metadata,
        },
      });

      // Update execution status based on event
      const updateData: any = {};
      switch (eventType) {
        case "OPENED":
          updateData.openedAt = new Date();
          updateData.status = "OPENED";
          break;
        case "CLICKED":
          updateData.clickedAt = new Date();
          updateData.status = "CLICKED";
          break;
        case "REPLIED":
          updateData.repliedAt = new Date();
          updateData.status = "REPLIED";
          break;
        case "BOUNCED":
          updateData.status = "BOUNCED";
          break;
        case "CONVERTED":
          updateData.convertedAt = new Date();
          updateData.status = "CONVERTED";
          updateData.revenue = metadata?.revenue || 0;
          break;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.campaignExecution.update({
          where: { id: executionId },
          data: updateData,
        });
      }

      logger.info(`Email event tracked: ${eventType} for execution ${executionId}`);

    } catch (error) {
      logger.error(`Error tracking email event:`, error);
      throw error;
    }
  }

  async getCampaignComparison(campaignIds: string[]): Promise<CampaignMetrics[]> {
    try {
      const metrics = await Promise.all(
        campaignIds.map(id => this.calculateCampaignMetrics(id))
      );

      return metrics.sort((a, b) => b.conversionRate - a.conversionRate);

    } catch (error) {
      logger.error("Error comparing campaigns:", error);
      throw error;
    }
  }

  private async storeCampaignAnalytics(metrics: CampaignMetrics): Promise<void> {
    try {
      await prisma.campaignAnalytics.upsert({
        where: { campaignId: metrics.campaignId },
        update: {
          totalSent: metrics.totalSent,
          totalDelivered: metrics.totalDelivered,
          totalOpened: metrics.totalOpened,
          totalClicked: metrics.totalClicked,
          totalReplied: metrics.totalReplied,
          totalBounced: metrics.totalBounced,
          totalUnsubscribed: metrics.totalUnsubscribed,
          totalConverted: metrics.totalConverted,
          deliveryRate: metrics.deliveryRate,
          openRate: metrics.openRate,
          clickRate: metrics.clickRate,
          replyRate: metrics.replyRate,
          bounceRate: metrics.bounceRate,
          unsubscribeRate: metrics.unsubscribeRate,
          conversionRate: metrics.conversionRate,
          totalRevenue: metrics.totalRevenue,
          averageRevenuePerLead: metrics.averageRevenuePerLead,
          lastCalculated: new Date(),
        },
        create: {
          campaignId: metrics.campaignId,
          totalSent: metrics.totalSent,
          totalDelivered: metrics.totalDelivered,
          totalOpened: metrics.totalOpened,
          totalClicked: metrics.totalClicked,
          totalReplied: metrics.totalReplied,
          totalBounced: metrics.totalBounced,
          totalUnsubscribed: metrics.totalUnsubscribed,
          totalConverted: metrics.totalConverted,
          deliveryRate: metrics.deliveryRate,
          openRate: metrics.openRate,
          clickRate: metrics.clickRate,
          replyRate: metrics.replyRate,
          bounceRate: metrics.bounceRate,
          unsubscribeRate: metrics.unsubscribeRate,
          conversionRate: metrics.conversionRate,
          totalRevenue: metrics.totalRevenue,
          averageRevenuePerLead: metrics.averageRevenuePerLead,
        },
      });
    } catch (error) {
      logger.error("Error storing campaign analytics:", error);
    }
  }
}

export const campaignAnalyticsService = new CampaignAnalyticsService();
