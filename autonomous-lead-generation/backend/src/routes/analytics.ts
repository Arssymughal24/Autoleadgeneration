import { Router, Request, Response } from "express";
import { campaignAnalyticsService } from "../services/analytics/campaignAnalyticsService";
import { abTestingService } from "../services/analytics/abTestingService";
import { customScoringService } from "../services/analytics/customScoringService";

const router = Router();

// Dashboard Metrics
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const metrics = await campaignAnalyticsService.getDashboardMetrics();
    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard metrics",
    });
  }
});

// Campaign Analytics
router.get("/campaigns/:id", async (req: Request, res: Response) => {
  try {
    const metrics = await campaignAnalyticsService.calculateCampaignMetrics(req.params.id);
    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch campaign analytics",
    });
  }
});

router.post("/campaigns/:id/recalculate", async (req: Request, res: Response) => {
  try {
    const metrics = await campaignAnalyticsService.calculateCampaignMetrics(req.params.id);
    res.json({
      success: true,
      data: metrics,
      message: "Analytics recalculated successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to recalculate campaign analytics",
    });
  }
});

// Campaign Comparison
router.post("/campaigns/compare", async (req: Request, res: Response) => {
  try {
    const { campaignIds } = req.body;
    if (!Array.isArray(campaignIds) || campaignIds.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Please provide at least 2 campaign IDs for comparison",
      });
    }

    const comparison = await campaignAnalyticsService.getCampaignComparison(campaignIds);
    res.json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to compare campaigns",
    });
  }
});

// Email Event Tracking
router.post("/events/email", async (req: Request, res: Response) => {
  try {
    const { executionId, eventType, metadata } = req.body;
    await campaignAnalyticsService.trackEmailEvent(executionId, eventType, metadata);
    
    res.json({
      success: true,
      message: "Email event tracked successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to track email event",
    });
  }
});

// A/B Testing Endpoints
router.post("/ab-tests", async (req: Request, res: Response) => {
  try {
    const testId = await abTestingService.createAbTest(req.body);
    res.status(201).json({
      success: true,
      data: { testId },
      message: "A/B test created successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create A/B test",
    });
  }
});

router.post("/ab-tests/:id/start", async (req: Request, res: Response) => {
  try {
    await abTestingService.startAbTest(req.params.id);
    res.json({
      success: true,
      message: "A/B test started successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to start A/B test",
    });
  }
});

router.get("/ab-tests/:id/results", async (req: Request, res: Response) => {
  try {
    const results = await abTestingService.getTestResults(req.params.id);
    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to get A/B test results",
    });
  }
});

router.post("/ab-tests/:id/conclude", async (req: Request, res: Response) => {
  try {
    const results = await abTestingService.concludeTest(req.params.id);
    res.json({
      success: true,
      data: results,
      message: "A/B test concluded successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to conclude A/B test",
    });
  }
});

router.get("/ab-tests", async (req: Request, res: Response) => {
  try {
    const tests = await abTestingService.getActiveTests();
    res.json({
      success: true,
      data: tests,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch A/B tests",
    });
  }
});

router.post("/ab-tests/:testId/assign/:leadId", async (req: Request, res: Response) => {
  try {
    const variantId = await abTestingService.assignVariant(req.params.testId, req.params.leadId);
    res.json({
      success: true,
      data: { variantId },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to assign variant",
    });
  }
});

router.post("/ab-tests/:testId/track", async (req: Request, res: Response) => {
  try {
    const { variantId, leadId, event, value } = req.body;
    await abTestingService.trackEvent(req.params.testId, variantId, leadId, event, value);
    
    res.json({
      success: true,
      message: "A/B test event tracked successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to track A/B test event",
    });
  }
});

// Custom Scoring Endpoints
router.post("/scoring/algorithms", async (req: Request, res: Response) => {
  try {
    const algorithmId = await customScoringService.createScoringAlgorithm(req.body);
    res.status(201).json({
      success: true,
      data: { algorithmId },
      message: "Scoring algorithm created successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create scoring algorithm",
    });
  }
});

router.get("/scoring/algorithms", async (req: Request, res: Response) => {
  try {
    const algorithms = await customScoringService.getScoringAlgorithms();
    res.json({
      success: true,
      data: algorithms,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch scoring algorithms",
    });
  }
});

router.post("/scoring/score-lead", async (req: Request, res: Response) => {
  try {
    const { leadId, algorithmId } = req.body;
    const result = await customScoringService.scoreLeadWithAlgorithm(leadId, algorithmId);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to score lead",
    });
  }
});

router.post("/scoring/batch-score", async (req: Request, res: Response) => {
  try {
    const { leadIds, algorithmId } = req.body;
    const results = await customScoringService.batchScoreLeads(leadIds, algorithmId);
    
    const resultsArray = Array.from(results.entries()).map(([leadId, result]) => ({
      leadId,
      ...result,
    }));
    
    res.json({
      success: true,
      data: resultsArray,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to batch score leads",
    });
  }
});

router.get("/scoring/leads/:id/scores", async (req: Request, res: Response) => {
  try {
    const scores = await customScoringService.getLeadScores(req.params.id);
    res.json({
      success: true,
      data: scores,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch lead scores",
    });
  }
});

export { router as analyticsRoutes };
