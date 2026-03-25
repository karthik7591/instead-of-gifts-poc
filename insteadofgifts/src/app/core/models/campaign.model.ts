export type CampaignStatus = 'active' | 'closed' | 'new';
export type CampaignFundUse = 'educational' | 'personal';

export interface Campaign {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  targetAmount: number;       // in smallest currency unit (cents)
  amountCollected: number;    // in smallest currency unit (cents)
  currency: string;           // ISO 4217, e.g. 'USD'
  status: CampaignStatus;
  isPro: boolean;
  customMessage?: string;     // Pro only — organiser's personal note
  organiserName: string;
  organiserAvatarUrl?: string;
  createdAt: string;          // ISO 8601
  endsAt?: string;            // ISO 8601, optional deadline
  fundUse?: CampaignFundUse;
}
