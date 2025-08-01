import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { leadScoringService } from "../services/ai/leadScoringService";
import { campaignAnalyticsService } from "../services/analytics/campaignAnalyticsService";
import { logger } from "../utils/logger";

const router = Router();
const prisma = new PrismaClient();

const formSubmissionSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  company: z.string().min(1),
  industry: z.string().optional(),
  jobTitle: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  message: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  referrer: z.string().optional(),
});

const emailEventSchema = z.object({
  executionId: z.string(),
  event: z.enum(["sent", "delivered", "opened", "clicked", "replied", "bounced", "unsubscribed"]),
  timestamp: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// Form Submission Webhook
router.post("/form-submission", async (req: Request, res: Response) => {
  try {
    const data = formSubmissionSchema.parse(req.body);
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

    // Check if lead exists
    let lead = await prisma.lead.findUnique({
      where: { email: data.email },
    });

    if (!lead) {
      // Create new lead
      lead = await prisma.lead.create({
        data: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          company: data.company,
          industry: data.industry,
          jobTitle: data.jobTitle,
          phone: data.phone,
          website: data.website,
          source: "FORM_SUBMISSION",
          status: "NEW",
        },
      });

      // Log lead creation
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: "LEAD_CREATED",
          description: "Lead created from form submission",
          metadata: {
            source: "form_webhook",
            userAgent,
            ipAddress,
          },
        },
      });
    } else {
      // Update existing lead status
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: "QUALIFIED",
          updatedAt: new Date(),
        },
      });
    }

    // Create form submission record
    const formSubmission = await prisma.formSubmission.create({
      data: {
        leadId: lead.id,
        formData: {
          ...data,
          additionalFields: req.body.additionalFields || {},
        },
        ipAddress,
        userAgent,
        referrer: data.referrer || req.get("Referer"),
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
      },
    });

    // Log form submission
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "FORM_SUBMITTED",
        description: `Form submitted: ${data.message ? "with message" : "contact form"}`,
        metadata: {
          formSubmissionId: formSubmission.id,
          hasMessage: !!data.message,
          utmSource: data.utmSource,
          utmCampaign: data.utmCampaign,
        },
      },
    });

    // Trigger AI scoring asynchronously
    leadScoringService.scoreLead(lead.id).catch(error => {
      logger.error(`Failed to score lead ${lead.id} after form submission:`, error);
    });

    // Generate AI follow-up
    const followUpPromise = leadScoringService.generateFollowUp(
      lead.id,
      `Lead submitted contact form. Message: ${data.message || "No message provided"}`
    ).then(followUp => {
      logger.info(`Follow-up generated for lead ${lead.id}`);
      // Here you would typically send the follow-up email
      return followUp;
    }).catch(error => {
      logger.error(`Failed to generate follow-up for lead ${lead.id}:`, error);
    });

    res.json({
      success: true,
      data: {
        leadId: lead.id,
        formSubmissionId: formSubmission.id,
        status: "processed",
        message: "Form submission received and processed successfully",
      },
    });

    // Send notification (async)
    // This would typically integrate with Slack/email notifications
    logger.info(`🎯 New qualified lead: ${data.firstName} ${data.lastName} from ${data.company}`);

  } catch (error) {
    logger.error("Form submission webhook error:", error);
    
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Validation error",
        details: error.errors,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Failed to process form submission",
      });
    }
  }
});

// Email Event Webhook (for email service providers)
router.post("/email-events", async (req: Request, res: Response) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    
    for (const eventData of events) {
      try {
        const data = emailEventSchema.parse(eventData);
        
        await campaignAnalyticsService.trackEmailEvent(
          data.executionId,
          data.event.toUpperCase(),
          {
            ...data.metadata,
            timestamp: data.timestamp,
            provider: req.get("User-Agent"),
          }
        );
        
        logger.debug(`Email event tracked: ${data.event} for execution ${data.executionId}`);
        
      } catch (error) {
        logger.error("Error processing email event:", error);
      }
    }
    
    res.json({
      success: true,
      message: "Email events processed",
      processed: events.length,
    });

  } catch (error) {
    logger.error("Email events webhook error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process email events",
    });
  }
});

// Salesforce Webhook (for CRM synchronization)
router.post("/salesforce", async (req: Request, res: Response) => {
  try {
    const { type, leadId, salesforceId, data } = req.body;
    
    switch (type) {
      case "lead_converted":
        // Update lead status and track revenue
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            status: "CONVERTED",
            salesforceId,
          },
        });

        // Track conversion in campaign executions
        if (data.revenue) {
          await prisma.campaignExecution.updateMany({
            where: { leadId },
            data: {
              revenue: data.revenue,
              convertedAt: new Date(),
              status: "CONVERTED",
            },
          });
        }

        await prisma.activity.create({
          data: {
            leadId,
            type: "STATUS_CHANGED",
            description: `Lead converted in Salesforce. Revenue: $${data.revenue || 0}`,
            metadata: {
              salesforceId,
              revenue: data.revenue,
              source: "salesforce_webhook",
            },
          },
        });

        break;

      case "lead_updated":
        // Sync lead data from Salesforce
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            enrichedData: {
              salesforceData: data,
              lastSync: new Date().toISOString(),
            },
          },
        });

        break;

      default:
        logger.warn(`Unknown Salesforce webhook type: ${type}`);
    }

    res.json({
      success: true,
      message: "Salesforce webhook processed",
    });

  } catch (error) {
    logger.error("Salesforce webhook error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process Salesforce webhook",
    });
  }
});

// Lead Source Webhooks (for UpLead, ZoomInfo, etc.)
router.post("/lead-source/:source", async (req: Request, res: Response) => {
  try {
    const source = req.params.source.toUpperCase();
    const leads = Array.isArray(req.body.leads) ? req.body.leads : [req.body];

    const created = [];
    const errors = [];

    for (const leadData of leads) {
      try {
        // Check if lead already exists
        const existingLead = await prisma.lead.findUnique({
          where: { email: leadData.email },
        });

        if (existingLead) {
          // Update enriched data
          await prisma.lead.update({
            where: { id: existingLead.id },
            data: {
              enrichedData: {
                ...existingLead.enrichedData,
                [source.toLowerCase()]: leadData,
                lastEnriched: new Date().toISOString(),
              },
            },
          });
          continue;
        }

        // Create new lead
        const lead = await prisma.lead.create({
          data: {
            email: leadData.email,
            firstName: leadData.firstName || leadData.first_name || "",
            lastName: leadData.lastName || leadData.last_name || "",
            company: leadData.company || leadData.company_name || "",
            industry: leadData.industry,
            jobTitle: leadData.jobTitle || leadData.job_title,
            phone: leadData.phone,
            website: leadData.website || leadData.company_website,
            linkedinUrl: leadData.linkedinUrl || leadData.linkedin_url,
            source: source as any,
            enrichedData: {
              [source.toLowerCase()]: leadData,
              enrichedAt: new Date().toISOString(),
            },
          },
        });

        created.push(lead.id);

        // Log creation
        await prisma.activity.create({
          data: {
            leadId: lead.id,
            type: "LEAD_CREATED",
            description: `Lead imported from ${source}`,
            metadata: {
              source: source.toLowerCase(),
              dataQuality: leadData.confidence || "unknown",
            },
          },
        });

        // Trigger AI scoring
        leadScoringService.scoreLead(lead.id).catch(error => {
          logger.error(`Failed to score imported lead ${lead.id}:`, error);
        });

      } catch (error) {
        errors.push({
          email: leadData.email,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    res.json({
      success: true,
      data: {
        created: created.length,
        errors: errors.length,
        leadIds: created,
        errorDetails: errors,
      },
      message: `Processed ${leads.length} leads from ${source}`,
    });

  } catch (error) {
    logger.error(`Lead source webhook error (${req.params.source}):`, error);
    res.status(500).json({
      success: false,
      error: "Failed to process lead source webhook",
    });
  }
});

// Health check for webhook endpoints
router.get("/health", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Webhook endpoints are healthy",
    endpoints: {
      "POST /form-submission": "Handle lead form submissions",
      "POST /email-events": "Track email engagement events",
      "POST /salesforce": "Salesforce CRM synchronization",
      "POST /lead-source/:source": "Import leads from external sources",
    },
    timestamp: new Date().toISOString(),
  });
});

export { router as webhookRoutes };
