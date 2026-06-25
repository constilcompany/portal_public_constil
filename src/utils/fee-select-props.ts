import type { CSSObjectWithLabel } from "react-select";

/** Portal menu so tax/discount dropdowns are not clipped by item cards */
export const feeSelectPortalProps = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : undefined,
  menuPosition: "fixed" as const,
  maxMenuHeight: 280,
  styles: {
    menuPortal: (base: CSSObjectWithLabel) => ({
      ...base,
      zIndex: 9999,
    }),
    menu: (base: CSSObjectWithLabel) => ({
      ...base,
      zIndex: 9999,
    }),
    menuList: (base: CSSObjectWithLabel) => ({
      ...base,
      maxHeight: 280,
    }),
  },
};
