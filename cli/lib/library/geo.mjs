// Country references for map highlights → world-atlas (Natural Earth) feature ids, which are
// ISO 3166-1 numeric codes. Accepts the numeric id, an ISO alpha-2 code, a Chinese name from
// the table below, or the English name as Natural Earth spells it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_DIR } from "../core/ffmpeg.mjs";

// alpha-2 → [numeric, Chinese name]
const ISO = {
  cn: ["156", "中国"], tw: ["158", "台湾"], hk: ["344", "香港"], mo: ["446", "澳门"], jp: ["392", "日本"], kr: ["410", "韩国"], kp: ["408", "朝鲜"],
  mn: ["496", "蒙古"], in: ["356", "印度"], pk: ["586", "巴基斯坦"], bd: ["050", "孟加拉国"], vn: ["704", "越南"], th: ["764", "泰国"], my: ["458", "马来西亚"],
  sg: ["702", "新加坡"], id: ["360", "印度尼西亚"], ph: ["608", "菲律宾"], mm: ["104", "缅甸"], kh: ["116", "柬埔寨"], la: ["418", "老挝"], np: ["524", "尼泊尔"],
  lk: ["144", "斯里兰卡"], af: ["004", "阿富汗"], ir: ["364", "伊朗"], iq: ["368", "伊拉克"], sa: ["682", "沙特阿拉伯"], ae: ["784", "阿联酋"], il: ["376", "以色列"],
  tr: ["792", "土耳其"], sy: ["760", "叙利亚"], jo: ["400", "约旦"], qa: ["634", "卡塔尔"], kw: ["414", "科威特"], ye: ["887", "也门"], om: ["512", "阿曼"],
  kz: ["398", "哈萨克斯坦"], uz: ["860", "乌兹别克斯坦"], ru: ["643", "俄罗斯"], ua: ["804", "乌克兰"], by: ["112", "白俄罗斯"], pl: ["616", "波兰"],
  de: ["276", "德国"], fr: ["250", "法国"], gb: ["826", "英国"], ie: ["372", "爱尔兰"], es: ["724", "西班牙"], pt: ["620", "葡萄牙"], it: ["380", "意大利"],
  nl: ["528", "荷兰"], be: ["056", "比利时"], ch: ["756", "瑞士"], at: ["040", "奥地利"], cz: ["203", "捷克"], hu: ["348", "匈牙利"], ro: ["642", "罗马尼亚"],
  gr: ["300", "希腊"], se: ["752", "瑞典"], no: ["578", "挪威"], fi: ["246", "芬兰"], dk: ["208", "丹麦"], is: ["352", "冰岛"], rs: ["688", "塞尔维亚"],
  us: ["840", "美国"], ca: ["124", "加拿大"], mx: ["484", "墨西哥"], cu: ["192", "古巴"], br: ["076", "巴西"], ar: ["032", "阿根廷"], cl: ["152", "智利"],
  co: ["170", "哥伦比亚"], pe: ["604", "秘鲁"], ve: ["862", "委内瑞拉"], eg: ["818", "埃及"], za: ["710", "南非"], ng: ["566", "尼日利亚"], et: ["231", "埃塞俄比亚"],
  ke: ["404", "肯尼亚"], ma: ["504", "摩洛哥"], dz: ["012", "阿尔及利亚"], ly: ["434", "利比亚"], sd: ["729", "苏丹"], cd: ["180", "刚果（金）"],
  au: ["036", "澳大利亚"], nz: ["554", "新西兰"], gl: ["304", "格陵兰"],
};

let names = null;
function atlasNames() {
  if (!names) {
    names = new Map();
    const file = join(TEMPLATE_DIR, "node_modules", "world-atlas", "countries-50m.json");
    if (existsSync(file)) {
      const topo = JSON.parse(readFileSync(file, "utf8"));
      for (const g of topo.objects.countries.geometries) if (g.id && g.properties?.name) names.set(g.properties.name.toLowerCase(), String(g.id));
    }
  }
  return names;
}

export function resolveCountry(ref) {
  if (typeof ref !== "string" || !ref.trim()) return null;
  const r = ref.trim();
  if (/^\d{1,3}$/.test(r)) return r.padStart(3, "0");
  const iso = ISO[r.toLowerCase()];
  if (iso) return iso[0];
  for (const [num, zh] of Object.values(ISO)) if (zh === r) return num;
  return atlasNames().get(r.toLowerCase()) ?? null;
}
