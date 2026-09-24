export const colors = {
  gold: '#FFB300', navy: '#0D1B2A', white: '#FFFFFF', background: '#F7F8FA', surface: '#FFFFFF', mutedSurface: '#F1F3F5',
  textPrimary: '#0D1B2A', textSecondary: '#667085', textMuted: '#98A2B3', border: '#E4E7EC', borderStrong: '#D0D5DD',
  success: '#16875D', danger: '#D92D20', info: '#2563EB',
} as const;
export const darkColors = {
  backgroundPrimary: '#07111A', backgroundSecondary: '#091721', surfacePrimary: '#0D1822', surfaceElevated: '#111F2A', surfaceHover: '#162733',
  borderDefault: 'rgba(255,255,255,.09)', borderStrong: 'rgba(255,255,255,.16)', goldPrimary: '#F2B51D', goldHover: '#FFC928',
  textPrimary: '#F8FAFC', textSecondary: '#A9B3BD', textMuted: '#74808C', success: '#4CAF6A', warning: '#F59E0B', danger: '#E44B4B', info: '#3B82F6',
} as const;
/** React Native-safe tokens shared by the three SUGAT mobile clients. */
export const mobileColors = {
  background: '#07111A', backgroundSecondary: '#091721', surface: '#0D1822', surfaceElevated: '#111F2A',
  surfacePressed: '#162733', gold: '#F2B51D', goldPressed: '#FFC928', textPrimary: '#F8FAFC',
  textSecondary: '#A9B3BD', textMuted: '#74808C', border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.16)', success: '#4CAF6A', warning: '#F59E0B', danger: '#E44B4B',
  info: '#60A5FA', mapRoute: '#F2B51D', mapMoving: '#4CAF6A', mapIdle: '#F59E0B', mapOffline: '#74808C',
  // Compatibility aliases for existing mobile primitives while they migrate to semantic names.
  navy: '#07111A', white: '#F8FAFC', mutedSurface: '#111F2A',
} as const;
export const mobileTypography = { screenTitle: 28, sectionTitle: 20, cardTitle: 17, body: 15, secondary: 13, status: 11 } as const;
export const mobileRadii = { input: 12, card: 16, elevated: 20, pill: 999 } as const;
export const mobileTouchTargets = { minimum: 48, primary: 56 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radii = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
export const shadows = { card: '0 8px 24px rgba(13,27,42,.08)', hero: '0 18px 50px rgba(13,27,42,.22)' } as const;
export const typography = { hero: 40, pageTitle: 30, section: 20, card: 17, body: 15, caption: 12, status: 11 } as const;
export const touchTarget = 48;
export const statusColors = { ACTIVE: colors.success, LIVE: colors.success, READY: colors.gold, PENDING: colors.gold, STALE: colors.gold, OFFLINE: colors.textMuted, INACTIVE: colors.textMuted, FAILED: colors.danger, ERROR: colors.danger, INFO: colors.info } as const;
export const SUGAT_BRAND_NAME = 'SUGAT' as const;
export const SUGAT_BRAND_TAGLINE = 'WHERE JOURNEYS MEET' as const;
export const SUGAT_PASSENGER_HEADLINE = "SEE YOUR RIDE. KNOW WHEN IT'S COMING." as const;
