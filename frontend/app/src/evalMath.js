// 综测加减分明细求和：与后端 backend/app/services/convert.py 规则严格一致
// - 带 + 的数字一律视为加分项（「基础分+23」「六级成绩587分+5」中的 +23 / +5）；
// - 带 - 的数字仅当其左侧不是数字或小数点时视为减分项（避开「2024-2025」年份区间）；
// - 无符号数字（如「587分」）不计入；明细为空返回 null。
const PLUS_TERM = /[＋+]\s*(\d+(?:\.\d+)?)/g
const MINUS_TERM = /(?<![\d.])[-−]\s*(\d+(?:\.\d+)?)/g

const round2 = (v) => Math.round(v * 100) / 100

export function sumDetailTerms(detail) {
  if (!detail) return null
  let total = 0
  for (const m of String(detail).matchAll(PLUS_TERM)) total += parseFloat(m[1])
  for (const m of String(detail).matchAll(MINUS_TERM)) total -= parseFloat(m[1])
  return round2(total)
}

// 逐项列出识别到的加减分项（如 ['+23', '+0.5']），供「明细不符」展开详情展示
export function detailTerms(detail) {
  const terms = []
  if (!detail) return terms
  for (const m of String(detail).matchAll(PLUS_TERM)) terms.push(`+${m[1]}`)
  for (const m of String(detail).matchAll(MINUS_TERM)) terms.push(`-${m[1]}`)
  return terms
}
