import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { config } from "../../config";
import { logger } from "../../utils/logger";

const prisma = new PrismaClient();

export interface UpLeadSearchCriteria {
  company_name?: string;
  industry?: string[];
  job_title?: string[];
  company_size?: string;
  location?: string;
  department?: string[];
  seniority?: string[];
  limit?: number;
}

export interface UpLeadContact {
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  company_name: string;
  industry: string;
  phone?: string;
  linkedin_url?: string;
  company_website?: string;
  company_size?: string;
  location?: string;
  confidence: number;
}

export class UpLeadService {
  private baseUrl = config.leadSources.uplead.baseUrl;
  private apiKey = config.leadSources.uplead.apiKey;

  async searchContacts(criteria: UpLeadSearchCriteria): Promise<UpLeadContact[]> {
    try {
      if (!this.apiKey) {
        throw new Error('UpLead API key not configured');
      }

      const response = await axios.post(`${this.baseUrl}/contacts/search`, 
        {
          ...criteria,
          limit: criteria.limit || 50,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      logger.info(`UpLead search returned ${response.data.contacts?.length || 0} contacts`);
      return response.data.contacts || [];

    } catch (error) {
      logger.error('UpLead search error:', error);
      
      await prisma.integrationLog.create({
        data: {
          service: 'UpLead',
          operation: 'search_contacts',
          status: 'ERROR',
          request: criteria,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }

  async importLeads(criteria: UpLeadSearchCriteria, autoScore = true): Promise<string[]> {
    try {
      const contacts = await this.searchContacts(criteria);
      const importedLeadIds: string[] = [];

      for (const contact of contacts) {
        try {
          // Check if lead already exists
          const existingLead = await prisma.lead.findUnique({
            where: { email: contact.email },
          });

          if (existingLead) {
            // Update with UpLead data
            await prisma.lead.update({
              where: { id: existingLead.id },
              data: {
                enrichedData: {
                  ...existingLead.enrichedData,
                  uplead: contact,
                  lastEnriched: new Date().toISOString(),
                },
              },
            });
            continue;
          }

          // Create new lead
          const lead = await prisma.lead.create({
            data: {
              email: contact.email,
              firstName: contact.first_name,
              lastName: contact.last_name,
              company: contact.company_name,
              industry: contact.industry,
              jobTitle: contact.job_title,
              phone: contact.phone,
              website: contact.company_website,
              linkedinUrl: contact.linkedin_url,
              source: 'UPLEAD',
              enrichedData: {
                uplead: contact,
                confidence: contact.confidence,
                importedAt: new Date().toISOString(),
              },
            },
          });

          importedLeadIds.push(lead.id);

          // Log import
          await prisma.activity.create({
            data: {
              leadId: lead.id,
              type: 'LEAD_CREATED',
              description: `Lead imported from UpLead (confidence: ${contact.confidence}%)`,
              metadata: {
                source: 'uplead',
                confidence: contact.confidence,
                criteria,
              },
            },
          });

          // Trigger AI scoring if requested
          if (autoScore) {
            // Import and call scoring service
            const { leadScoringService } = await import('../ai/leadScoringService');
            leadScoringService.scoreLead(lead.id).catch(error => {
              logger.error(`Failed to score UpLead import ${lead.id}:`, error);
            });
          }

        } catch (leadError) {
          logger.error(`Error importing contact ${contact.email}:`, leadError);
        }
      }

      // Log successful import
      await prisma.integrationLog.create({
        data: {
          service: 'UpLead',
          operation: 'import_leads',
          status: 'SUCCESS',
          request: criteria,
          response: {
            totalFound: contacts.length,
            imported: importedLeadIds.length,
          },
        },
      });

      logger.info(`Imported ${importedLeadIds.length} leads from UpLead`);
      return importedLeadIds;

    } catch (error) {
      logger.error('UpLead import error:', error);
      throw error;
    }
  }

  async enrichLead(leadId: string): Promise<void> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
      });

      if (!lead) {
        throw new Error('Lead not found');
      }

      // Search for additional data
      const searchCriteria: UpLeadSearchCriteria = {
        company_name: lead.company,
        limit: 5,
      };

      const contacts = await this.searchContacts(searchCriteria);
      const matchingContact = contacts.find(c => 
        c.email.toLowerCase() === lead.email.toLowerCase() ||
        (c.first_name.toLowerCase() === lead.firstName.toLowerCase() && 
         c.last_name.toLowerCase() === lead.lastName.toLowerCase())
      );

      if (matchingContact) {
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            enrichedData: {
              ...lead.enrichedData,
              uplead: matchingContact,
              enrichedAt: new Date().toISOString(),
            },
            phone: lead.phone || matchingContact.phone,
            linkedinUrl: lead.linkedinUrl || matchingContact.linkedin_url,
            website: lead.website || matchingContact.company_website,
          },
        });

        await prisma.activity.create({
          data: {
            leadId,
            type: 'ENRICHMENT_COMPLETED',
            description: `Lead enriched with UpLead data (confidence: ${matchingContact.confidence}%)`,
            metadata: {
              service: 'uplead',
              confidence: matchingContact.confidence,
            },
          },
        });

        logger.info(`Lead ${leadId} enriched with UpLead data`);
      }

    } catch (error) {
      logger.error(`Error enriching lead ${leadId} with UpLead:`, error);
      throw error;
    }
  }

  async getUsageStats(): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/account/usage`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      return response.data;

    } catch (error) {
      logger.error('Error getting UpLead usage stats:', error);
      throw error;
    }
  }
}

export const upLeadService = new UpLeadService();
