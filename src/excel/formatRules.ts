/**
 * The value rules the registration forms apply, for the Excel importers
 * (docs/registration-import-plan.md §3.2). A cell that breaks one is not saved:
 * the field is left empty and the import report lists what was typed (D5).
 */

export type FormatRule = 'mobile' | 'email' | 'pincode' | 'gstin' | 'pan' | 'ifsc' | 'aadhaar';

interface RuleDefinition {
  /** The value as saved, or null when it breaks the rule. */
  clean: (text: string) => string | null;
  /** Why it was refused, for the report. */
  message: string;
  /** What the Instructions sheet says about the column. */
  note: string;
}

const upper = (text: string) => text.replace(/\s+/g, '').toUpperCase();

export const FORMAT_RULES: Record<FormatRule, RuleDefinition> = {
  mobile: {
    // The forms' CONTACT_NO: 10 digits starting with 6-9. "+91", spaces and dashes are dropped.
    clean: (text) => {
      let digits = text.replace(/[\s\-().]/g, '');
      if (digits.startsWith('+91')) digits = digits.slice(3);
      else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
      else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
      return /^[6-9]\d{9}$/.test(digits) ? digits : null;
    },
    message: 'is not a 10-digit mobile number starting with 6-9',
    note: '10-digit mobile number starting with 6-9',
  },
  email: {
    clean: (text) => (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(text.trim()) ? text.trim() : null),
    message: 'is not an email address',
    note: 'Email address',
  },
  pincode: {
    clean: (text) => (/^\d{6}$/.test(text.trim()) ? text.trim() : null),
    message: 'must be 6 digits',
    note: '6 digits',
  },
  gstin: {
    // 2-digit state code, the PAN, entity number, "Z", check character.
    clean: (text) => {
      const value = upper(text);
      return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value) ? value : null;
    },
    message: 'is not a 15-character GSTIN (e.g. 27ABCDE1234F1Z5)',
    note: '15-character GSTIN, e.g. 27ABCDE1234F1Z5',
  },
  pan: {
    clean: (text) => {
      const value = upper(text);
      return /^[A-Z]{5}\d{4}[A-Z]$/.test(value) ? value : null;
    },
    message: 'is not a PAN (e.g. ABCDE1234F)',
    note: 'PAN, e.g. ABCDE1234F',
  },
  ifsc: {
    clean: (text) => {
      const value = upper(text);
      return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value) ? value : null;
    },
    message: 'is not an IFSC code (e.g. SBIN0001234)',
    note: 'IFSC code, e.g. SBIN0001234',
  },
  aadhaar: {
    clean: (text) => {
      const digits = text.replace(/[\s-]/g, '');
      return /^\d{12}$/.test(digits) ? digits : null;
    },
    message: 'is not a 12-digit Aadhaar number',
    note: '12-digit Aadhaar number',
  },
};

/** Mobiles and emails are the contact values no two records may share (D4). */
export const contactKind = (rule: FormatRule | undefined): 'phone' | 'email' | null =>
  rule === 'mobile' ? 'phone' : rule === 'email' ? 'email' : null;
