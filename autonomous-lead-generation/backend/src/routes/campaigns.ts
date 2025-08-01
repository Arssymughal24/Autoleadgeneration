import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const router = Router();
const prisma = new PrismaClient();

const createCampaignSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["EMAIL", "LINKEDIN_AD", "GOOGLE_AD", "CONTENT_DELIVERY", "NURTURE_SEQUENCE"]),
  trigger: z.object({
    tags: z.array(z.string()).optional(),
    score: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
    }).optional(),
  }),
  template: z.object({
    subject: z.string().optional(),
    content: z.string(),
    variables: z.record(z.string()).optional(),
  }),
});

// GET /api/campaigns
router.get("/", async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            executions: true,
          },
        },
      },
    });
    
    res.json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch campaigns",
    });
  }
});

// POST /api/campaigns
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = createCampaignSchema.parse(req.body);
    
    const campaign = await prisma.campaign.create({
      data: validatedData,
    });
    
    res.status(201).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Validation error",
        details: error.errors,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Failed to create campaign",
      });
    }
  }
});

// GET /api/campaigns/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        executions: {
          include: {
            lead: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found",
      });
    }
    
    res.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch campaign",
    });
  }
});

export { router as campaignRoutes };
