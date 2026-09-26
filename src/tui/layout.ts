export interface Layout { width: number; chatWidth: number; sidebarWidth: number; sidebarVisible: boolean }
export function layout(termWidth: number, forced: boolean | undefined): Layout {
  const width = Math.max(20, termWidth);
  const sidebarVisible = forced ?? termWidth >= 110;
  const sidebarWidth = sidebarVisible && termWidth >= 70 ? termWidth >= 120 ? 40 : 30 : 0;
  return { width, chatWidth: width - sidebarWidth, sidebarWidth, sidebarVisible: sidebarWidth > 0 };
}
