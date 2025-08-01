import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import { config } from "../../config";
import { logger } from "../../utils/logger";

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export interface LeadScoreResult {
  score: number;
  confidence: number;
  tags: string[];
  reasoning: string;
  features: {
    companyScore: number;
    titleScore: number;
    industryScore: number;
    engagementScore: number;
  };
}

export class LeadScoringService {
  async scoreLead(leadId: string): Promise<LeadScoreResult> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          activities: true,
          campaigns: true,
          formSubmission: true,
        },
      });

      if (!lead) {
        throw new Error("Lead not found");
      }

      // Log activity
      await prisma.activity.create({
        data: {
          leadId,
          type: "AI_SCORING_STARTED",
          description: "Started AI lead scoring analysis",
        },
      });

      const prompt = this.buildScoringPrompt(lead);
      
      const completion = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: "system",
            content: `You are an expert lead scoring AI. Analyze leads based on:
            - Company size and industry
            - Job title and seniority
            - Engagement history
            - Demographic fit
            
            Return a JSON object with:
            - score: number (0-100)
            - confidence: number (0-1)
            - tags: string[] (relevant tags for campaigns)
            - reasoning: string (explanation)
            - features: { companyScore, titleScore, industryScore, engagementScore }
            
            Consider high-value indicators:
            - Enterprise companies (500+ employees)
            - Decision-maker titles (VP, Director, Manager)
            - SaaS/Tech industries
            - Active engagement
            
            Provide actionable tags like: "high-value", "decision-maker", "enterprise", "tech-industry", "nurture-ready"`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(completion.choices[0].message.content || "{}") as LeadScoreResult;

      // Update lead with score and tags
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          score: Math.round(result.score),
          tags: result.tags,
          customScores: {
            ai_gpt4: {
              score: result.score,
              confidence: result.confidence,
              timestamp: new Date().toISOString(),
              features: result.features,
            },
          },
        },
      });

      // Log completion
      await prisma.activity.create({
        data: {
          leadId,
          type: "AI_SCORED",
          description: `AI scored lead: ${result.score}/100 (${result.confidence * 100}% confidence)`,
          metadata: {
            score: result.score,
            confidence: result.confidence,
            tags: result.tags,
          },
        },
      });

      logger.info(`Lead ${leadId} scored: ${result.score}/100`);
      return result;

    } catch (error) {
      logger.error(`Error scoring lead ${leadId}:`, error);
      
      await prisma.activity.create({
        data: {
          leadId,
          type: "ERROR_OCCURRED",
          description: `AI scoring failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      });

      throw error;
    }
  }

  async generateFollowUp(leadId: string, context: string): Promise<string> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          formSubmission: true,
          activities: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      });

      if (!lead) {
        throw new Error("Lead not found");
      }

      const completion = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: "system",
            content: `You are a sales follow-up expert. Write personalized, professional follow-up emails that:
            - Reference specific lead information
            - Provide value (insights, resources)
            - Include clear call-to-action
            - Sound human and conversational
            - Are brief and scannable
            
            Keep emails under 150 words with compelling subject lines.`
          },
          {
            role: "user",
            content: `Lead Information:
            Name: ${lead.firstName} ${lead.lastName}
            Company: ${lead.company}
            Industry: ${lead.industry || "Unknown"}
            Title: ${lead.jobTitle || "Unknown"}
            Score: ${lead.score}/100
            Tags: ${lead.tags.join(", ")}
            
            Context: ${context}
            
            Form Data: ${lead.formSubmission ? JSON.stringify(lead.formSubmission.formData) : "No form submission"}
            
            Generate a personalized follow-up email with subject line.`
          }
        ],
        temperature: 0.7,
      });

      const followUp = completion.choices[0].message.content || "";

      // Log activity
      await prisma.activity.create({
        data: {
          leadId,
          type: "FOLLOW_UP_GENERATED",
          description: "AI generated personalized follow-up",
          metadata: {
            context,
            followUp: followUp.substring(0, 500),
          },
        },
      });

      return followUp;

    } catch (error) {
      logger.error(`Error generating follow-up for lead ${leadId}:`, error);
      throw error;
    }
  }

  async batchScoreLeads(leadIds: string[]): Promise<Map<string, LeadScoreResult>> {
    const results = new Map<string, LeadScoreResult>();
    
    // Process in batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < leadIds.length; i += batchSize) {
      const batch = leadIds.slice(i, i + batchSize);
      const promises = batch.map(id => this.scoreLead(id));
      
      try {
        const batchResults = await Promise.allSettled(promises);
        
        batchResults.forEach((result, index) => {
          const leadId = batch[index];
          if (result.status === "fulfilled") {
            results.set(leadId, result.value);
          } else {
            logger.error(`Failed to score lead ${leadId}:`, result.reason);
          }
        });
        
        // Rate limiting delay
        if (i + batchSize < leadIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger.error("Batch scoring error:", error);
      }
    }
    
    return results;
  }

  private buildScoringPrompt(lead: any): string {
    return `Lead Profile:
    Name: ${lead.firstName} ${lead.lastName}
    Email: ${lead.email}
    Company: ${lead.company}
    Industry: ${lead.industry || "Unknown"}
    Job Title: ${lead.jobTitle || "Unknown"}
    Source: ${lead.source}
    
    Enriched Data: ${lead.enrichedData ? JSON.stringify(lead.enrichedData).substring(0, 500) : "None"}
    
    Activity History:
    ${lead.activities.map((a: any) => `- ${a.type}: ${a.description}`).join("\n").substring(0, 500)}
    
    Campaign History:
    ${lead.campaigns.length} previous campaign interactions
    
    Form Submission: ${lead.formSubmission ? "Yes - engaged prospect" : "No"}
    
    Analyze this lead and provide scoring with detailed breakdown.`;
  }
}

export const leadScoringService = new LeadScoringService();
