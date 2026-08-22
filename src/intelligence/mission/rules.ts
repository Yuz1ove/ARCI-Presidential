const MEDICAL_TERMS = [
  /\bmedical\b/i,
  /\bdialysis\b/i,
  /\bparamedic\b/i,
  /\bambulance\b/i,
  /洗腎/u,
  /醫療/u,
  /急救/u,
];

const ASSISTANCE_TERMS = [/\bassist(?:ance)?\b/i, /\bhelp\b/i, /\brescue\b/i, /救援/u, /幫助/u];
const CELLULAR_TERMS = [/\bcellular\b/i, /\bcell service\b/i, /\bbase station\b/i, /基地台/u];
const UNAVAILABLE_TERMS = [/\bunavailable\b/i, /\bdown\b/i, /\boffline\b/i, /\bno service\b/i, /斷線/u, /無法使用/u];
const BATTERY_TERMS = [/\bbattery\b/i, /電池/u, /電量/u];
const LOW_TERMS = [/\blow\b/i, /\bcritical\b/i, /不足/u, /低/u];
const GENERAL_COMMUNICATION_TERMS = [/\bgeneral communication\b/i, /\bsend (?:a )?message\b/i, /一般通訊/u];
const AUTHORITY_DIRECTIVES = [
  /ignore (?:all )?(?:policy|rules)/i,
  /force (?:satellite|execution)/i,
  /bypass (?:policy|safety|validator)/i,
  /mark (?:this )?as delivered/i,
  /pretend (?:the )?ack/i,
  /increase maxiterations/i,
  /executioncapability/i,
];

function includesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export const missionRules = {
  medical: (text: string): boolean => includesAny(text, MEDICAL_TERMS),
  assistance: (text: string): boolean => includesAny(text, ASSISTANCE_TERMS),
  cellularUnavailable: (text: string): boolean =>
    includesAny(text, CELLULAR_TERMS) && includesAny(text, UNAVAILABLE_TERMS),
  batteryLow: (text: string): boolean =>
    includesAny(text, BATTERY_TERMS) && includesAny(text, LOW_TERMS),
  generalCommunication: (text: string): boolean => includesAny(text, GENERAL_COMMUNICATION_TERMS),
  authorityDirective: (text: string): boolean => includesAny(text, AUTHORITY_DIRECTIVES),
};
