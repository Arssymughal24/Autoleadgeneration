import axios, { AxiosResponse } from 'axios';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

interface ZoomInfoContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  company: {
    name: string;
    website: string;
    industry: string;
    employee_count: number;
    revenue: number;
    location: {
      city: string;
      state: string;
      country: string;
    };
  };
  social_profiles: {
    linkedin_url?: string;
    twitter_url?: string;
  };
}

interface ZoomInfoSearchParams {
  companyNames?: string[];
  industries?: string[];
  jobTitles?: string[];
  locations?: string[];
  employeeCountMin?: number;
  employeeCountMax?: number;
  revenueMin?: number;
  revenueMax?: number;
  departments?: string[];
  seniorityLevels?: string[];
  limit?: number;
}

interface ZoomInfoResponse {
  data: ZoomInfoContact[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}

class ZoomInfoService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.ZOOMINFO_API_KEY || '';
    this.baseUrl = 'https://api.zoominfo.com/search';
    
    if (!this.apiKey) {
      logger.warn('ZoomInfo API key not configured');
    }
  }

  /**
   * Search for contacts based on criteria
   */
  async searchContacts(params: ZoomInfoSearchParams): Promise<ZoomInfoResponse> {
    try {
      const response: AxiosResponse<ZoomInfoResponse> = await axios.post(
        `${this.baseUrl}/contact`,
        {
          query: {
            person: {
              job_titles: params.jobTitles,
              departments: params.departments,
              seniority_levels: params.seniorityLevels,
            },
            company: {
              company_names: params.companyNames,
              industries: params.industries,
              locations: params.locations,
              employee_count: {
                min: params.employeeCountMin,
                max: params.employeeCountMax,
              },
              revenue: {
                min: params.revenueMin,
                max: params.revenueMax,
              },
            },
          },
          per_page: params.limit || 50,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Log API usage
      await this.logApiUsage('search_contacts', response.data.meta.total);

      return response.data;
    } catch (error) {
      logger.error('ZoomInfo search failed:', error);
      throw new Error('Failed to search ZoomInfo contacts');
    }
  }

  /**
   * Import leads from ZoomInfo search
   */
  async importLeads(searchParams: ZoomInfoSearchParams): Promise<string[]> {
    try {
      const searchResult = await this.searchContacts(searchParams);
      const leadIds: string[] = [];

      for (const contact of searchResult.data) {
        // Check if lead already exists
        const existingLead = await prisma.lead.findUnique({
          where: { email: contact.email },
        });

        if (!existingLead) {
          const lead = await prisma.lead.create({
            data: {
              email: contact.email,
              firstName: contact.first_name,
              lastName: contact.last_name,
              company: contact.company.name,
              title: contact.job_title,
              phone: contact.phone,
              website: contact.company.website,
              industry: contact.company.industry,
              source: 'zoominfo',
              status: 'new',
              enrichedData: {
                zoominfo_id: contact.id,
                company_size: contact.company.employee_count,
                company_revenue: contact.company.revenue,
                company_location: contact.company.location,
                social_profiles: contact.social_profiles,
              },
            },
          });
          leadIds.push(lead.id);
        }
      }

      logger.info(`Imported ${leadIds.length} leads from ZoomInfo`);
      return leadIds;
    } catch (error) {
      logger.error('ZoomInfo import failed:', error);
      throw error;
    }
  }

  /**
   * Enrich existing lead with ZoomInfo data
   */
  async enrichLead(leadId: string): Promise<void> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
      });

      if (!lead || !lead.email) {
        throw new Error('Lead not found or missing email');
      }

      // Search for the specific contact by email
      const searchResult = await this.searchContacts({
        // ZoomInfo doesn't support email search directly, so we search by company and name
        companyNames: lead.company ? [lead.company] : undefined,
        limit: 10,
      });

      // Find matching contact by email
      const matchingContact = searchResult.data.find(
        contact => contact.email.toLowerCase() === lead.email.toLowerCase()
      );

      if (matchingContact) {
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            phone: matchingContact.phone || lead.phone,
            title: matchingContact.job_title || lead.title,
            website: matchingContact.company.website || lead.website,
            industry: matchingContact.company.industry || lead.industry,
            enrichedData: {
              ...lead.enrichedData as object,
              zoominfo_id: matchingContact.id,
              company_size: matchingContact.company.employee_count,
              company_revenue: matchingContact.company.revenue,
              company_location: matchingContact.company.location,
              social_profiles: matchingContact.social_profiles,
              enriched_at: new Date().toISOString(),
            },
          },
        });

        logger.info(`Enriched lead ${leadId} with ZoomInfo data`);
      } else {
        logger.warn(`No ZoomInfo match found for lead ${leadId}`);
      }
    } catch (error) {
      logger.error(`ZoomInfo enrichment failed for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Get company information
   */
  async getCompanyInfo(companyName: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/company`,
        {
          query: {
            company_names: [companyName],
          },
          per_page: 1,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.data.length > 0) {
        return response.data.data[0];
      }

      return null;
    } catch (error) {
      logger.error('ZoomInfo company lookup failed:', error);
      throw error;
    }
  }

  /**
   * Batch process leads for enrichment
   */
  async batchEnrichLeads(leadIds: string[]): Promise<void> {
    const batchSize = 10;
    
    for (let i = 0; i < leadIds.length; i += batchSize) {
      const batch = leadIds.slice(i, i + batchSize);
      
      // Process batch with delay to respect rate limits
      await Promise.all(
        batch.map(async (leadId, index) => {
          await new Promise(resolve => setTimeout(resolve, index * 100));
          try {
            await this.enrichLead(leadId);
          } catch (error) {
            logger.error(`Failed to enrich lead ${leadId}:`, error);
          }
        })
      );

      // Delay between batches
      if (i + batchSize < leadIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(): Promise<any> {
    try {
      const logs = await prisma.integrationLog.findMany({
        where: {
          service: 'zoominfo',
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const totalRequests = logs.length;
      const successfulRequests = logs.filter(log => log.status === 'success').length;
      const failedRequests = logs.filter(log => log.status === 'error').length;

      return {
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
        recentLogs: logs.slice(0, 10),
      };
    } catch (error) {
      logger.error('Failed to get ZoomInfo usage stats:', error);
      throw error;
    }
  }

  /**
   * Log API usage for tracking
   */
  private async logApiUsage(action: string, recordsProcessed: number): Promise<void> {
    try {
      await prisma.integrationLog.create({
        data: {
          service: 'zoominfo',
          action,
          status: 'success',
          recordsProcessed,
          metadata: {
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      logger.error('Failed to log ZoomInfo usage:', error);
    }
  }
}

export default new ZoomInfoService();