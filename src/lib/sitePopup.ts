/**
 * เนื้อหาหน้าต่างหมุดสถานที่ในหน้าจัดทริป (Google Maps InfoWindow)
 * ชื่อ/ที่อยู่สถานที่มาจากผู้ใช้ — ใส่ผ่าน textContent เท่านั้น ห้ามต่อ innerHTML (เคยเป็น stored XSS)
 * ปุ่มผูก event ด้วย addEventListener (ไม่ฝัง onclick ในสตริง)
 */
export function buildSitePopupContent(
  doc: Document,
  site: { name?: string | null; address?: string | null },
  opts: { isSelected: boolean; stopIndex: number; onAdd: () => void },
): HTMLElement {
  const content = doc.createElement("div")
  content.className = "p-2 min-w-[200px] text-foreground"
  const nameEl = doc.createElement("div")
  nameEl.className = "font-bold text-accent mb-1 text-xs"
  nameEl.textContent = site.name ?? ""
  const addressEl = doc.createElement("div")
  addressEl.className = "text-[10px] text-muted-foreground mb-3"
  addressEl.textContent = site.address ?? ""
  content.append(nameEl, addressEl)
  if (!opts.isSelected) {
    const btn = doc.createElement("button")
    btn.type = "button"
    btn.className = "w-full bg-accent text-white text-[10px] py-2 px-2 rounded hover:bg-accent/80 transition-colors h-10"
    btn.textContent = "+ เพิ่มเป็นจุดส่ง"
    btn.addEventListener("click", opts.onAdd)
    content.append(btn)
  } else {
    const selectedEl = doc.createElement("div")
    selectedEl.className = "text-[10px] font-bold text-blue-500"
    selectedEl.textContent = `✓ เลือกเป็นจุดส่งที่ ${opts.stopIndex + 1} แล้ว`
    content.append(selectedEl)
  }
  return content
}
