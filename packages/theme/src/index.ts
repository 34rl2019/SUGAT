export const colors = {
  gold: '#FFB300', navy: '#0D1B2A', white: '#FFFFFF', background: '#F7F8FA', surface: '#FFFFFF', mutedSurface: '#F1F3F5',
  textPrimary: '#0D1B2A', textSecondary: '#667085', textMuted: '#98A2B3', border: '#E4E7EC', borderStrong: '#D0D5DD',
  success: '#16875D', danger: '#D92D20', info: '#2563EB',
} as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radii = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
export const shadows = { card: '0 8px 24px rgba(13,27,42,.08)', hero: '0 18px 50px rgba(13,27,42,.22)' } as const;
export const typography = { hero: 40, pageTitle: 30, section: 20, card: 17, body: 15, caption: 12, status: 11 } as const;
export const touchTarget = 48;
export const statusColors = { ACTIVE: colors.success, LIVE: colors.success, READY: colors.gold, PENDING: colors.gold, STALE: colors.gold, OFFLINE: colors.textMuted, INACTIVE: colors.textMuted, FAILED: colors.danger, ERROR: colors.danger, INFO: colors.info } as const;
export const SUGAT_BRAND_NAME = 'SUGAT' as const;
export const SUGAT_BRAND_TAGLINE = 'WHERE JOURNEYS MEET' as const;
export const SUGAT_PASSENGER_HEADLINE = "SEE YOUR RIDE. KNOW WHEN IT'S COMING." as const;
