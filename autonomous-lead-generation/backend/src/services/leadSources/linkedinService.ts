import axios, { AxiosResponse } from 'axios';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

interface LinkedInProfile {
  id: string;
  firstName: string;
  lastName: string;
  headline: string;
  profilePicture?: string;
  location: {
    country: string;
    region: string;
  };
  industry: string;
  positions: {
    title: string;
    companyName: string;
    companyId?: string;
    current: boolean;
    startDate: {
      month: number;
      year: number;
    };
    endDate?: {
      month: number;
      year: number;
    };
  }[];
  educations: {
    schoolName: string;
    degree?: string;
    fieldOfStudy?: string;
  }[];
  connectionDegree: number;
  publicProfileUrl: string;
}

interface LinkedInCompany {
  id: string;
  name: string;
  description?: string;
  website?: string;
  industry: string;
  employeeCount: number;
  location: {
    country: string;
    region: string;
    city: string;
  };
  specialties: string[];
  foundedYear?: number;
  logoUrl?: string;
}

interface LinkedInSearchParams {
  keywords?: string;
  title?: string;
  company?: string;
  industry?: string;
  location?: string;
  connectionDegree?: number[];
  currentCompany?: string[];
  pastCompany?: string[];
  school?: string[];
  profileLanguage?: string;
  limit?: number;
}

interface LinkedInSearchResponse {
  elements: LinkedInProfile[];
  paging: {
    count: number;
    start: number;
    total: number;
  };
}

class LinkedInService {
  private accessToken: string;
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;

  constructor() {
    this.clientId = process.env.LINKEDIN_CLIENT_ID || '';
    this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET || '';
    this.accessToken = process.env.LINKEDIN_ACCESS_TOKEN || '';
    this.baseUrl = 'https://api.linkedin.com/v2';
    
    if (!this.clientId || !this.clientSecret) {
      logger.warn('LinkedIn API credentials not configured');
    }
  }

  /**
   * Search for people using LinkedIn Sales Navigator API
   */
  async searchPeople(params: LinkedInSearchParams): Promise<LinkedInSearchResponse> {
    try {
      if (!this.accessToken) {
        throw new Error('LinkedIn access token not available');
      }

      const searchParams = new URLSearchParams();
      
      if (params.keywords) searchParams.append('keywords', params.keywords);
      if (params.title) searchParams.append('title', params.title);
      if (params.company) searchParams.append('company', params.company);
      if (params.industry) searchParams.append('industry', params.industry);
      if (params.location) searchParams.append('location', params.location);
      if (params.currentCompany) {
        params.currentCompany.forEach(company => searchParams.append('currentCompany', company));
      }
      if (params.pastCompany) {
        params.pastCompany.forEach(company => searchParams.append('pastCompany', company));
      }
      if (params.school) {
        params.school.forEach(school => searchParams.append('school', school));
      }
      if (params.profileLanguage) searchParams.append('profileLanguage', params.profileLanguage);
      
      searchParams.append('count', String(params.limit || 25));

      const response: AxiosResponse<LinkedInSearchResponse> = await axios.get(
        `${this.baseUrl}/peopleSearch?${searchParams.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      );

      // Log API usage
      await this.logApiUsage('search_people', response.data.elements.length);

      return response.data;
    } catch (error) {
      logger.error('LinkedIn people search failed:', error);
      throw new Error('Failed to search LinkedIn profiles');
    }
  }

  /**
   * Get detailed profile information
   */
  async getProfile(profileId: string): Promise<LinkedInProfile> {
    try {
      const response: AxiosResponse<LinkedInProfile> = await axios.get(
        `${this.baseUrl}/people/${profileId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('LinkedIn profile fetch failed:', error);
      throw error;
    }
  }

  /**
   * Get company information
   */
  async getCompany(companyId: string): Promise<LinkedInCompany> {
    try {
      const response: AxiosResponse<LinkedInCompany> = await axios.get(
        `${this.baseUrl}/companies/${companyId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('LinkedIn company fetch failed:', error);
      throw error;
    }
  }

  /**
   * Import leads from LinkedIn search
   */
  async importLeads(searchParams: LinkedInSearchParams): Promise<string[]> {
    try {
      const searchResult = await this.searchPeople(searchParams);
      const leadIds: string[] = [];

      for (const profile of searchResult.elements) {
        // Extract current position
        const currentPosition = profile.positions.find(pos => pos.current);
        
        // Create lead data
        const leadData = {
          firstName: profile.firstName,
          lastName: profile.lastName,
          company: currentPosition?.companyName || '',
          title: currentPosition?.title || profile.headline,
          industry: profile.industry,
          source: 'linkedin',
          status: 'new' as const,
          enrichedData: {
            linkedin_id: profile.id,
            linkedin_url: profile.publicProfileUrl,
            headline: profile.headline,
            location: profile.location,
            connection_degree: profile.connectionDegree,
            profile_picture: profile.profilePicture,
            positions: profile.positions,
            educations: profile.educations,
            imported_at: new Date().toISOString(),
          },
        };

        // For LinkedIn, we don't always have email, so we create leads without email
        // They can be enriched later through other services
        const lead = await prisma.lead.create({
          data: leadData,
        });

        leadIds.push(lead.id);
      }

      logger.info(`Imported ${leadIds.length} leads from LinkedIn`);
      return leadIds;
    } catch (error) {
      logger.error('LinkedIn import failed:', error);
      throw error;
    }
  }

  /**
   * Enrich existing lead with LinkedIn data
   */
  async enrichLead(leadId: string): Promise<void> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
      });

      if (!lead) {
        throw new Error('Lead not found');
      }

      // Search for the lead on LinkedIn
      const searchParams: LinkedInSearchParams = {
        keywords: `${lead.firstName} ${lead.lastName}`,
        company: lead.company || undefined,
        limit: 10,
      };

      const searchResult = await this.searchPeople(searchParams);

      // Find best match
      const matchingProfile = this.findBestMatch(lead, searchResult.elements);

      if (matchingProfile) {
        const currentPosition = matchingProfile.positions.find(pos => pos.current);

        await prisma.lead.update({
          where: { id: leadId },
          data: {
            title: currentPosition?.title || lead.title,
            company: currentPosition?.companyName || lead.company,
            industry: matchingProfile.industry || lead.industry,
            enrichedData: {
              ...lead.enrichedData as object,
              linkedin_id: matchingProfile.id,
              linkedin_url: matchingProfile.publicProfileUrl,
              headline: matchingProfile.headline,
              location: matchingProfile.location,
              connection_degree: matchingProfile.connectionDegree,
              profile_picture: matchingProfile.profilePicture,
              positions: matchingProfile.positions,
              educations: matchingProfile.educations,
              enriched_at: new Date().toISOString(),
            },
          },
        });

        logger.info(`Enriched lead ${leadId} with LinkedIn data`);
      } else {
        logger.warn(`No LinkedIn match found for lead ${leadId}`);
      }
    } catch (error) {
      logger.error(`LinkedIn enrichment failed for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Find best matching profile for a lead
   */
  private findBestMatch(lead: any, profiles: LinkedInProfile[]): LinkedInProfile | null {
    if (profiles.length === 0) return null;

    // Score each profile based on similarity
    const scoredProfiles = profiles.map(profile => {
      let score = 0;

      // Name match (high weight)
      if (profile.firstName.toLowerCase() === lead.firstName?.toLowerCase()) score += 30;
      if (profile.lastName.toLowerCase() === lead.lastName?.toLowerCase()) score += 30;

      // Company match (medium weight)
      const currentPosition = profile.positions.find(pos => pos.current);
      if (currentPosition && lead.company) {
        const companyMatch = currentPosition.companyName.toLowerCase().includes(lead.company.toLowerCase()) ||
                            lead.company.toLowerCase().includes(currentPosition.companyName.toLowerCase());
        if (companyMatch) score += 20;
      }

      // Title match (medium weight)
      if (currentPosition && lead.title) {
        const titleMatch = currentPosition.title.toLowerCase().includes(lead.title.toLowerCase()) ||
                          lead.title.toLowerCase().includes(currentPosition.title.toLowerCase());
        if (titleMatch) score += 15;
      }

      // Industry match (low weight)
      if (profile.industry && lead.industry) {
        const industryMatch = profile.industry.toLowerCase().includes(lead.industry.toLowerCase()) ||
                             lead.industry.toLowerCase().includes(profile.industry.toLowerCase());
        if (industryMatch) score += 5;
      }

      return { profile, score };
    });

    // Sort by score and return the best match if score is above threshold
    const sorted = scoredProfiles.sort((a, b) => b.score - a.score);
    return sorted[0].score > 50 ? sorted[0].profile : null;
  }

  /**
   * Get connection requests recommendations
   */
  async getConnectionRecommendations(targetCriteria: any): Promise<LinkedInProfile[]> {
    try {
      const searchParams: LinkedInSearchParams = {
        title: targetCriteria.title,
        company: targetCriteria.company,
        industry: targetCriteria.industry,
        location: targetCriteria.location,
        connectionDegree: [2], // 2nd degree connections
        limit: 50,
      };

      const searchResult = await this.searchPeople(searchParams);
      return searchResult.elements;
    } catch (error) {
      logger.error('Failed to get connection recommendations:', error);
      throw error;
    }
  }

  /**
   * Send connection request (if Sales Navigator API supports it)
   */
  async sendConnectionRequest(profileId: string, message?: string): Promise<boolean> {
    try {
      // Note: LinkedIn's actual API doesn't allow sending connection requests
      // This would need to be done through Sales Navigator's specific API
      // or through browser automation (which has legal/ToS implications)
      
      logger.warn('Connection request sending not implemented - requires Sales Navigator API');
      return false;
    } catch (error) {
      logger.error('Failed to send connection request:', error);
      return false;
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(): Promise<any> {
    try {
      const logs = await prisma.integrationLog.findMany({
        where: {
          service: 'linkedin',
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
      logger.error('Failed to get LinkedIn usage stats:', error);
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
          service: 'linkedin',
          action,
          status: 'success',
          recordsProcessed,
          metadata: {
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      logger.error('Failed to log LinkedIn usage:', error);
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<string> {
    try {
      // Implementation would depend on OAuth flow setup
      // This is a placeholder for token refresh logic
      logger.warn('Access token refresh not implemented');
      return this.accessToken;
    } catch (error) {
      logger.error('Failed to refresh LinkedIn access token:', error);
      throw error;
    }
  }
}

export default new LinkedInService();