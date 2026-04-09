export type SensitiveType =
  | "name"
  | "email"
  | "phone"
  | "taiwan_id"
  | "date"
  | "birthday"
  | "address"
  | "medical_record_no"
  | "identifiable_code";

export type SensitiveHit = {
  type: SensitiveType;
  label: string;
  value: string;
  start: number;
  end: number;
};

type Rule = {
  type: SensitiveType;
  label: string;
  regex: RegExp;
};

const RULES: Rule[] = [
  {
    type: "name",
    label: "姓名",
    regex:
      /(?:姓名叫|名字是|我叫|病人姓名是|患者姓名是|我是|我的名字|我叫做)\s*[:：]?\s*[\u4e00-\u9fff]{2,4}/gi,
  },
  {
    type: "email",
    label: "Email",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    type: "phone",
    label: "電話",
    regex:
      /(?:\+886[-\s]?)?0\d{1,2}[-\s]?\d{6,8}|\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/gi,
  },
  {
    type: "taiwan_id",
    label: "身分證字號",
    regex: /\b[A-Z][12]\d{8}\b/gi,
  },
  {
    type: "birthday",
    label: "生日",
    regex:
      /(?:生日是|出生日期是|我的生日是|DOB|birth\s*date)\s*[:：]?\s*(?:(?:民國)?\d{2,4}(?:年|[\/.-])\d{1,2}(?:月|[\/.-])\d{1,2}(?:日)?|\d{1,2}[\/.-]\d{1,2}|\d{1,2}月\d{1,2}(?:日|號)?|(?:十[一二]?|[一二三四五六七八九]|十一|十二|兩)月(?:三十一|三十|二十九|二十八|二十七|二十六|二十五|二十四|二十三|二十二|二十一|二十|十九|十八|十七|十六|十五|十四|十三|十二|十一|十|九|八|七|六|五|四|三|二|一)(?:日|號)?)/giu,
  },
  {
    type: "medical_record_no",
    label: "病歷號",
    regex:
      /(?:病歷號|病歷編號|我的病歷號是|病歷號是|我的病歷號|MRN|Chart\s*No|Record\s*No)\s*[:：]?\s*(\d{9}[A-Z])\b/gi,
  },
  {
    type: "address",
    label: "地址",
    regex:
      /(?:地址是|住址是|通訊地址在|我住|住在)\s*[:：]?\s*[\u4e00-\u9fff0-9]{1,}(?:市|縣)[\u4e00-\u9fff0-9]{1,}(?:區|鄉|鎮|市)[\u4e00-\u9fff0-9巷弄路街段號樓之\-–—\s]{2,}/gi,
  },
  {
    type: "address",
    label: "地址",
    regex:
      /[\u4e00-\u9fff]{2,}(?:市|縣)[\u4e00-\u9fff]{1,}(?:區|鄉|鎮|市)[\u4e00-\u9fff0-9巷弄路街段號樓之\-–—\s]{3,}\d+號?/gi,
  },
  {
    type: "identifiable_code",
    label: "可識別編號",
    regex:
      /(?:學號|員工編號|患者編號|病患編號|個案編號|病例編號|ID是)\s*[:：]?\s*[A-Z0-9-]{4,20}/gi,
  },
];

function dedupeHits(hits: SensitiveHit[]): SensitiveHit[] {
  const map = new Map<string, SensitiveHit>();
  for (const hit of hits) {
    const key = `${hit.type}-${hit.start}-${hit.end}-${hit.value}`;
    if (!map.has(key)) map.set(key, hit);
  }
  return Array.from(map.values()).sort((a, b) => a.start - b.start);
}

export function detectSensitiveInfo(input: string): SensitiveHit[] {
  if (!input?.trim()) return [];
  const hits: SensitiveHit[] = [];

  for (const rule of RULES) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(input)) !== null) {
      hits.push({
        type: rule.type,
        label: rule.label,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });

      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
  }

  return dedupeHits(hits);
}

function maskValue(type: SensitiveType, value: string): string {
  switch (type) {
    case "name":
      return "患者";

    case "email": {
      const [name, domain] = value.split("@");
      if (!domain) return "[已遮罩Email]";
      const safeName =
        name.length <= 2 ? `${name[0] ?? "*"}***` : `${name.slice(0, 2)}***`;
      return `${safeName}@${domain}`;
    }

    case "phone": {
      const digits = value.replace(/[^\d]/g, "");
      if (digits.length < 6) return "[已遮罩電話]";
      return `${digits.slice(0, 3)}****${digits.slice(-2)}`;
    }

    case "taiwan_id":
      return `${value.slice(0, 1)}*******${value.slice(-2)}`;

    case "date":
    case "birthday":
      return "患者生日";

    case "medical_record_no":
      return "患者病歷號";

    case "address":
      return "地址";

    case "identifiable_code":
      return "編號";

    default:
      return "[已遮罩]";
  }
}

export function normalizeLegacyMaskedText(input: string): string {
  if (!input) return input;

  return input
    .replace(/\[已遮罩姓名\]/g, "患者")
    .replace(/\[已遮罩名字\]/g, "患者")
    .replace(/\[已遮罩病人姓名\]/g, "患者")
    .replace(/\[已遮罩患者姓名\]/g, "患者")
    .replace(/\[已遮罩地址\]/g, "地址")
    .replace(/\[已遮罩日期\]/g, "患者生日")
    .replace(/\[已遮罩病歷號\]/g, "患者病歷號")
    .replace(/\[已遮罩編號\]/g, "編號");
}

export function maskSensitiveInfo(input: string): string {
  const hits = detectSensitiveInfo(input);
  if (hits.length === 0) return normalizeLegacyMaskedText(input);

  let output = input;
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    output =
      output.slice(0, hit.start) +
      maskValue(hit.type, hit.value) +
      output.slice(hit.end);
  }

  return normalizeLegacyMaskedText(output);
}