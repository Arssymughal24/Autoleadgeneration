import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { healthRoutes } from "./routes/health";
import { leadRoutes } from "./routes/leads";
import { campaignRoutes } from "./routes/campaigns";
import { analyticsRoutes } from "./routes/analytics";
import { webhookRoutes } from "./routes/webhooks";

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.nodeEnv === "production" ? 
    ["https://yourdomain.com"] : 
    ["http://localhost:3000", "http://localhost:5173"],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.nodeEnv === "production" ? 100 : 1000, // Limit each IP
  message: {
    success: false,
    error: "Too many requests from this IP, please try again later.",
  },
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // Higher limit for webhooks
  skip: (req) => {
    // Skip rate limiting for trusted webhook sources
    const trustedIPs = ["127.0.0.1", "::1"];
    return trustedIPs.includes(req.ip || "");
  },
});

app.use("/api/webhooks", webhookLimiter);
app.use("/api", limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging middleware
app.use(requestLogger);

// API Routes
app.use("/api/health", healthRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/webhooks", webhookRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Autonomous Lead Generation Engine",
    version: "1.0.0",
    documentation: "/api/health",
    features: [
      "AI-powered lead scoring",
      "Campaign analytics",
      "A/B testing framework",
      "Custom scoring algorithms",
      "CRM integration",
      "Real-time webhooks",
    ],
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: {
      "GET /": "Service information",
      "GET /api/health": "Health check",
      "GET /api/leads": "Lead management",
      "GET /api/campaigns": "Campaign management",
      "GET /api/analytics": "Analytics and insights",
      "POST /api/webhooks": "Webhook endpoints",
    },
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

export { app };
