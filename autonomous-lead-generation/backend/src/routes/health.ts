import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

router.get("/", async (req: Request, res: Response) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: "Autonomous Lead Generation Engine",
      version: "1.0.0",
      status: "healthy",
      components: {
        database: "connected",
        api: "operational",
        queues: "operational"
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      timestamp: new Date().toISOString(),
      service: "Autonomous Lead Generation Engine",
      status: "unhealthy",
      error: "Database connection failed"
    });
  }
});

export { router as healthRoutes };
