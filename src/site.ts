/**
 * QWEN + CLOUD ANSI Shadow art (30 + 33 = 64 chars wide, 6 rows).
 * Generated with figlet v1.11.0, ANSI Shadow font.
 */
const qwenLines = [
  ' ██████╗ ██╗    ██╗███████╗███╗   ██╗',
  '██╔═══██╗██║    ██║██╔════╝████╗  ██║',
  '██║   ██║██║ █╗ ██║█████╗  ██╔██╗ ██║',
  '██║▄▄ ██║██║███╗██║██╔══╝  ██║╚██╗██║',
  '╚██████╔╝╚███╔███╔╝███████╗██║ ╚████║',
  ' ╚══▀▀═╝  ╚══╝╚══╝ ╚══════╝╚═╝  ╚═══╝',
];

const cloudLines = [
  ' ██████╗██╗      ██████╗ ██╗   ██╗██████╗ ',
  '██╔════╝██║     ██╔═══██╗██║   ██║██╔══██╗',
  '██║     ██║     ██║   ██║██║   ██║██║  ██║',
  '██║     ██║     ██║   ██║██║   ██║██║  ██║',
  '╚██████╗███████╗╚██████╔╝╚██████╔╝██████╔╝',
  ' ╚═════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝ ',
];

/** Site configuration for QwenCloud CLI. */
export const site = {
  key: 'qwencloud',
  cliName: 'qwencloud',
  cliDisplayName: 'QwenCloud CLI',
  keychainService: 'qwencloud-cli',
  keychainAccount: 'cli_credentials',
  envPrefix: 'QWENCLOUD',
  configDirName: '.qwencloud',
  localConfigFile: '.qwencloud.json',
  apiEndpoint: 'https://cli.qwencloud.com',
  authEndpoint: 'https://t.qwencloud.com',
  docsBaseUrl: 'https://docs.qwencloud.com',
  websiteUrl: 'www.qwencloud.com',
  userAgentPrefix: 'qwencloud-cli',
  replPrompt: 'qwencloud ▸ ',
  asciiArt: {
    leftLines: qwenLines,
    rightLines: cloudLines,
    leftWidth: 37,
    rightWidth: 42,
    combinedWidth: 64,
  },
  doctorTitle: 'QwenCloud CLI Doctor',
  npmPackage: '@qwencloud/qwencloud-cli',
  defaults: {
    region: 'ap-southeast-1',
    language: 'en-US',
  },
  features: {
    enableRepl: true,
    enableUsageBreakdown: true,
    enableFreeTier: true,
    enableModelSearch: true,
    enableTokenPlan: true,
    enableCodingPlan: true,
    customHeaders: {},
    cdnBaseUrl: 'https://alioth-intl.alicdn.com/model-mapping',
    tokenPlanCommodityCodes: {
      teams: 'sfm_tokenplanteams_dp_intl',
      personal: 'sfm_tokenplanpersonal_dp_intl',
      addon: 'sfm_tokenplanteamsaddon_dp_intl',
    },
    codingPlanCommodityCode: 'sfm_codingplan_public_intl',
    currency: 'USD',
  },
  cacheTtlMs: 10 * 60 * 1000, // 10 minutes; file-cache default TTL
  uiTheme: {
    brand: '#3047F5',
    sectionTitle: '#3047F5',
    info: '#4F6DFF',
    data: '#5D7CFF',
    accent: '#F59E0B',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    border: '#3047F5',
    muted: '#6B7280',
    tableHeader: {
      bg: '#3047F5',
      fg: '#FFFFFF',
    },
    logo: {
      border: '#3047F5',
      gradientStart: '#6F86FF',
      gradientEnd: '#263BDE',
      link: '#38BDF8',
    },
    progressGradient: {
      from: '#263BDE',
      to: '#B8C7FF',
    },
  },
};
