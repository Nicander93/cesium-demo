let tooltip: HTMLDivElement | null = null;
export function useTooltip() {
  if (!tooltip) {
    createTooltip();
  }
  function createTooltip() {
    tooltip = document.createElement("div");
    tooltip.style.position = "absolute";
    tooltip.style.padding = "5px";
    tooltip.style.fontSize = "10px";
    tooltip.style.backgroundColor = "gray";
    tooltip.style.color = "white";
    tooltip.style.borderRadius = "3px";
    tooltip.style.pointerEvents = "none";
    tooltip.style.textWrapMode = "none";
    tooltip.style.zIndex = "1000";
    tooltip.style.transform = "translate(5px, -100%)";
    tooltip.innerText = "点击左键开始绘制,左键双击结束绘制！";
    // TODO: 先硬编码
    document.getElementById("CesiumContainer")?.append(tooltip);
  }
  function destroyTooltip() {
    if (tooltip) {
      document.getElementById("CesiumContainer")?.removeChild(tooltip);
    }
    tooltip = null;
  }
  function changeTooltipText(text: string) {
    tooltip && (tooltip.innerText = text);
  }
  function updateTooltipPosition(left: number, top: number) {
    tooltip && (tooltip.style.left = left + "px");
    tooltip && (tooltip.style.top = top + "px");
  }

  return {
    tooltip,
    destroyTooltip,
    changeTooltipText,
    updateTooltipPosition,
  };
}
