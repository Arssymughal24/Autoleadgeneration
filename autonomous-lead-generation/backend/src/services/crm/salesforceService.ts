import jsforce from "jsforce";
import { PrismaClient } from "@prisma/client";
import { config } from "../../config";
import { logger } from "../../utils/logger";

const prisma = new PrismaClient();

export interface SalesforceContact {
  FirstName: string;
  LastName: string;
  Email: string;
  Company: string;
  Title?: string;
  Phone?: string;
  Website?: string;
  Industry?: string;
  LeadSource?: string;
  Lead_Score__c?: number;
  AI_Tags__c?: string;
  Description?: string;
}

export class SalesforceService {
  private conn: jsforce.Connection;

  constructor() {
    this.conn = new jsforce.Connection({
      loginUrl: config.salesforce.sandbox ? 
        'https://test.salesforce.com' : 
        'https://login.salesforce.com'
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.conn.login(
        config.salesforce.username,
        config.salesforce.password + config.salesforce.token
      );
      
      logger.info('Connected to Salesforce successfully');
    } catch (error) {
      logger.error('Failed to connect to Salesforce:', error);
      throw error;
    }
  }

  async syncLead(leadId: string): Promise<string> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          activities: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
          formSubmission: true,
        },
      });

      if (!lead) {
        throw new Error('Lead not found');
      }

      // Check if lead already exists in Salesforce
      if (lead.salesforceId) {
        return await this.updateSalesforceLead(lead);
      }

      // Create new lead in Salesforce
      const salesforceContact: SalesforceContact = {
        FirstName: lead.firstName,
        LastName: lead.lastName,
        Email: lead.email,
        Company: lead.company,
        Title: lead.jobTitle,
        Phone: lead.phone,
        Website: lead.website,
        Industry: lead.industry,
        LeadSource: this.mapLeadSource(lead.source),
        Lead_Score__c: lead.score,
        AI_Tags__c: lead.tags.join(', '),
        Description: this.generateLeadDescription(lead),
      };

      await this.initialize();
      
      const result = await this.conn.sobject('Lead').create(salesforceContact);

      if (!result.success) {
        throw new Error(`Salesforce creation failed: ${JSON.stringify(result.errors)}`);
      }

      // Update lead with Salesforce ID
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          salesforceId: result.id,
          status: 'IN_CRM',
        },
      });

      // Log sync activity
      await prisma.activity.create({
        data: {
          leadId,
          type: 'CRM_SYNCED',
          description: `Lead synced to Salesforce: ${result.id}`,
          metadata: {
            salesforceId: result.id,
            score: lead.score,
            tags: lead.tags,
          },
        },
      });

      logger.info(`Lead ${leadId} synced to Salesforce: ${result.id}`);
      return result.id as string;

    } catch (error) {
      logger.error(`Error syncing lead ${leadId} to Salesforce:`, error);
      
      await prisma.activity.create({
        data: {
          leadId,
          type: 'ERROR_OCCURRED',
          description: `Salesforce sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });

      throw error;
    }
  }

  async updateSalesforceLead(lead: any): Promise<string> {
    try {
      await this.initialize();

      const updateData: Partial<SalesforceContact> = {
        Lead_Score__c: lead.score,
        AI_Tags__c: lead.tags.join(', '),
        Description: this.generateLeadDescription(lead),
      };

      // Add any new enriched data
      if (lead.enrichedData) {
        updateData.Description += `\n\nEnriched Data: ${JSON.stringify(lead.enrichedData).substring(0, 500)}`;
      }

      await this.conn.sobject('Lead').update({
        Id: lead.salesforceId,
        ...updateData,
      });

      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'CRM_SYNCED',
          description: `Lead updated in Salesforce: ${lead.salesforceId}`,
          metadata: {
            salesforceId: lead.salesforceId,
            updateType: 'score_and_tags',
          },
        },
      });

      logger.info(`Lead ${lead.id} updated in Salesforce: ${lead.salesforceId}`);
      return lead.salesforceId;

    } catch (error) {
      logger.error(`Error updating lead ${lead.id} in Salesforce:`, error);
      throw error;
    }
  }

  async batchSyncLeads(leadIds: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    
    // Process in batches to respect Salesforce API limits
    const batchSize = 10;
    
    for (let i = 0; i < leadIds.length; i += batchSize) {
      const batch = leadIds.slice(i, i + batchSize);
      const promises = batch.map(leadId => 
        this.syncLead(leadId).catch(error => {
          logger.error(`Batch sync failed for lead ${leadId}:`, error);
          return null;
        })
      );
      
      const batchResults = await Promise.all(promises);
      
      batchResults.forEach((salesforceId, index) => {
        if (salesforceId) {
          results.set(batch[index], salesforceId);
        }
      });
      
      // Rate limiting delay
      if (i + batchSize < leadIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  async trackConversion(leadId: string, revenue: number, details?: any): Promise<void> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
      });

      if (!lead || !lead.salesforceId) {
        throw new Error('Lead not found or not synced to Salesforce');
      }

      await this.initialize();

      // Create opportunity in Salesforce
      const opportunity = {
        Name: `${lead.company} - ${lead.firstName} ${lead.lastName}`,
        AccountId: null, // Would need to lookup/create account
        Amount: revenue,
        CloseDate: new Date().toISOString().split('T')[0],
        StageName: 'Closed Won',
        LeadSource: this.mapLeadSource(lead.source),
        Description: details ? JSON.stringify(details) : `Converted from lead ${leadId}`,
      };

      const result = await this.conn.sobject('Opportunity').create(opportunity);

      if (result.success) {
        // Update lead status
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: 'CONVERTED' },
        });

        // Log conversion
        await prisma.activity.create({
          data: {
            leadId,
            type: 'STATUS_CHANGED',
            description: `Lead converted - Opportunity created: ${result.id}`,
            metadata: {
              opportunityId: result.id,
              revenue,
              details,
            },
          },
        });

        logger.info(`Conversion tracked for lead ${leadId}: $${revenue}`);
      }

    } catch (error) {
      logger.error(`Error tracking conversion for lead ${leadId}:`, error);
      throw error;
    }
  }

  async getLeadUpdates(): Promise<any[]> {
    try {
      await this.initialize();

      // Query for recent lead updates
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const query = `
        SELECT Id, Email, Status, IsConverted, ConvertedDate, LastModifiedDate
        FROM Lead 
        WHERE LastModifiedDate >= ${yesterday.toISOString()}
        AND Email != null
      `;

      const result = await this.conn.query(query);
      return result.records || [];

    } catch (error) {
      logger.error('Error getting lead updates from Salesforce:', error);
      throw error;
    }
  }

  private mapLeadSource(source: string): string {
    const sourceMap: Record<string, string> = {
      'UPLEAD': 'UpLead',
      'ZOOMINFO': 'ZoomInfo',
      'SALES_NAVIGATOR': 'LinkedIn Sales Navigator',
      'FORM_SUBMISSION': 'Website',
      'MANUAL': 'Manual Entry',
      'API_IMPORT': 'API Import',
    };

    return sourceMap[source] || source;
  }

  private generateLeadDescription(lead: any): string {
    let description = `AI-Generated Lead Profile:\n`;
    description += `Score: ${lead.score}/100\n`;
    description += `Tags: ${lead.tags.join(', ')}\n`;
    description += `Source: ${lead.source}\n`;
    
    if (lead.enrichedData) {
      description += `\nEnriched with additional data from ${lead.source}`;
    }
    
    if (lead.activities && lead.activities.length > 0) {
      description += `\nRecent Activities:\n`;
      lead.activities.slice(0, 3).forEach((activity: any) => {
        description += `- ${activity.description}\n`;
      });
    }

    if (lead.formSubmission) {
      description += `\nForm Submission: ${JSON.stringify(lead.formSubmission.formData).substring(0, 200)}`;
    }

    return description.substring(0, 32000); // Salesforce field limit
  }
}

export const salesforceService = new SalesforceService();
