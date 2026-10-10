/**
 * กดไอคอนแอป (PWA ที่ติดตั้งแล้ว) ซ้ำขณะเปิดอยู่ → ดึงหน้าต่างเดิมขึ้นมาแทนการเปิดหน้าต่างใหม่ซ้อน
 *
 *  - manifest.json: `launch_handler.client_mode = ["focus-existing", "auto"]` — Chrome/Edge บนคอมฯ จะโฟกัสหน้าต่างเดิม
 *    โดยไม่ navigate (งานที่กรอกค้างไม่หาย) แล้วส่ง LaunchParams เข้า `window.launchQueue` ของหน้าต่างนั้น
 *    (ห้ามใช้ navigate-existing — โหลดหน้าเริ่มต้นทับ งานค้างหาย) · เบราว์เซอร์อื่นทำงานเหมือนเดิม
 *  - LAUNCH_SCRIPT: ฝัง inline ใน <head> ของ layout ราก (ต้อง setConsumer ก่อน React render) แล้วส่งต่อให้
 *    `RelaunchNotice` แสดงข้อความ · manifest ไม่มี shortcuts → การกดซ้ำ = อยู่หน้าเดิมเสมอ ไม่เปลี่ยนหน้า
 *    (ถ้าจะเพิ่ม shortcuts ต้องออกแบบการพาไปหน้าอื่น + กันฟอร์มที่ยังไม่บันทึกก่อน — ระบบยังไม่มีกลไกนี้)
 */

/** ชื่อแอปใน manifest.json (`name`) — เทสต์เทียบกับ manifest จริง */
const APP_NAME = 'LOTUS GROUP Transport'

export const RELAUNCH_MESSAGE = `ระบบ ${APP_NAME} เปิดอยู่แล้ว — ใช้หน้าต่างนี้ได้เลย`

/** event ที่สคริปต์ inline ยิงให้ React เมื่อเป็นการกดไอคอนซ้ำจริง */
export const RELAUNCH_EVENT = 'lotus:relaunch'

/** คิวการกดซ้ำที่เกิดก่อน React พร้อม (`window.__lotusRelaunches`) — RelaunchNotice อ่านแล้วล้าง */
export interface RelaunchWindow {
  __lotusRelaunches?: string[]
}

/**
 * แยก "การกดซ้ำจริง" ออกจาก LaunchParams ที่มาตอนหน้าเพิ่งเปิด:
 *  (1) ค่าของการเปิดที่สร้างหน้าต่างนี้เอง  (2) Chromium ส่งค่า launch ล่าสุดซ้ำทุกครั้งที่ reload
 * → จดเวลา event `load` แล้วข้ามทุกค่าที่มาก่อน load หรือภายใน 1000 ms หลัง load
 * ไม่มี launchQueue (เบราว์เซอร์อื่น / ไม่ได้ติดตั้งเป็นแอป) = ข้ามเงียบๆ
 * (เขียนแบบ ES5 ไม่พึ่ง import — ถูกฝังเป็นข้อความ และเทสต์รันข้อความเดียวกันนี้)
 */
export const LAUNCH_SCRIPT = `(function(){try{
var w=window,q=w.launchQueue;
if(!q||typeof q.setConsumer!=="function")return;
var loadAt=null;
w.addEventListener("load",function(){loadAt=performance.now()});
q.setConsumer(function(p){
var at=performance.now();
if(loadAt===null||at-loadAt<1000)return;
var url=p&&p.targetURL?String(p.targetURL):"";
(w.__lotusRelaunches=w.__lotusRelaunches||[]).push(url);
w.dispatchEvent(new CustomEvent(${JSON.stringify(RELAUNCH_EVENT)},{detail:{targetURL:url}}));
});
}catch(e){}})();`
