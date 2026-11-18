// Hero Engine 遊戲的桌面版：開一個視窗，載入打包好的遊戲（dist/<專案>/web）。
// 正式版不顯示命令列視窗（Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("遊戲視窗啟動失敗");
}
