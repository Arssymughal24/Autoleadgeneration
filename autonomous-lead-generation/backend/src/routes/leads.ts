import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const router = Router();
const prisma = new PrismaClient();

const createLeadSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  company: z.string().min(1),
  industry: z.string().optional(),
  jobTitle: z.string().optional(),
  source: z.enum(["UPLEAD", "ZOOMINFO", "SALES_NAVIGATOR", "MANUAL", "FORM_SUBMISSION"]),
});

// GET /api/leads
router.get("/", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, search, status, source } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: "insensitive" } },
        { firstName: { contains: search as string, mode: "insensitive" } },
        { lastName: { contains: search as string, mode: "insensitive" } },
        { company: { contains: search as string, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;
    if (source) where.source = source;
    
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          formSubmission: true,
          _count: {
            select: {
              campaigns: true,
              activities: true,
            },
          },
        },
      }),
      prisma.lead.count({ where }),
    ]);
    
    res.json({
      success: true,
      data: leads,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch leads",
    });
  }
});

// POST /api/leads
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = createLeadSchema.parse(req.body);
    
    const lead = await prisma.lead.create({
      data: validatedData,
    });
    
    // Log activity
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "LEAD_CREATED",
        description: `Lead created from ${validatedData.source}`,
      },
    });
    
    res.status(201).json({
      success: true,
      data: lead,
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
        error: "Failed to create lead",
      });
    }
  }
});

// GET /api/leads/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        formSubmission: true,
        campaigns: {
          include: {
            campaign: true,
          },
        },
        activities: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }
    
    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch lead",
    });
  }
});

export { router as leadRoutes };
