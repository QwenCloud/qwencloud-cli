export interface TokenPlanSupportedModel {
  modelId: string;
  modelBrand: string;
  modelName: string;
  capabilities: string[];
  badgeLabel?: string;
  badgeDescription?: string;
  isNew?: boolean;
}
