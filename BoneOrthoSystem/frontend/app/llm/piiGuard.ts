export type SensitiveType =
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
  regex: /(?:姓名|名字|我叫|病人姓名|患者姓名|患者|病人|我是|我的名字)\s*[:：]?\s*[\u4e00-\u9fff]{2,4}/gi,
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
      /\b(?:生日|出生日期|DOB|birth\s*date)\s*[:：]?\s*(?:民國)?\d{2,4}(?:年|[\/.-])\d{1,2}(?:月|[\/.-])\d{1,2}(?:日)?\b/gi,
  },
  {
    type: "date",
    label: "日期",
    regex:
      /\b(?:19|20)\d{2}[\/.-](?:0?[1-9]|1[0-2])[\/.-](?:0?[1-9]|[12]\d|3[01])\b|\b\d{2,3}[\/.-](?:0?[1-9]|1[0-2])[\/.-](?:0?[1-9]|[12]\d|3[01])\b/gi,
  },

  // 病歷號：關鍵字 + 值
  {
    type: "medical_record_no",
    label: "病歷號",
    regex:
      /(?:病歷號|病歷編號|MRN|Chart\s*No|Record\s*No)\s*[:：]?\s*[A-Z0-9-]{4,20}/gi,
  },

  // 地址：有地址關鍵字
  {
    type: "address",
    label: "地址",
    regex:
      /(?:地址|住址|通訊地址|我住|住在)\s*[:：]?\s*[\u4e00-\u9fff0-9]{1,}(?:市|縣)[\u4e00-\u9fff0-9]{1,}(?:區|鄉|鎮|市)[\u4e00-\u9fff0-9巷弄路街段號樓之\-–—\s]{2,}/gi,
  },

  // 地址：沒關鍵字但長得很像完整台灣地址
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
      /(?:學號|員工編號|患者編號|病患編號|個案編號|病例編號|編號|ID)\s*[:：]?\s*[A-Z0-9-]{4,20}/gi,
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
        return "[已遮罩姓名]";
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
      return "[已遮罩日期]";
    case "medical_record_no":
      return "[已遮罩病歷號]";  
    case "address":
      return "[已遮罩地址]";
    case "identifiable_code":
      return "[已遮罩編號]";
    default:
      return "[已遮罩]";
    
  }
}

export function maskSensitiveInfo(input: string): string {
  const hits = detectSensitiveInfo(input);
  if (hits.length === 0) return input;

  let output = input;
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    output =
      output.slice(0, hit.start) +
      maskValue(hit.type, hit.value) +
      output.slice(hit.end);
  }
  return output;
}