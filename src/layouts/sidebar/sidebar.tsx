import { useNavigate, useLocation } from "react-router-dom";
import type { ComponentType, SVGProps } from "react";
import { Headphones, Sparkles, Mail, Calendar, Workflow } from "lucide-react";
import IconHome from "../../assets/icons/homeIcone";
import InvoiceIcone from "../../assets/icons/invoiceicone";
import IconEstimates from "../../assets/icons/iconestimates";
import UserEdition from "../../assets/icons/useredit";
import IconProduto from "../../assets/icons/iconproduto";
import SettingIcon from "../../assets/icons/settingicon";

type SidebarIcon = ComponentType<SVGProps<SVGSVGElement>>;

type MenuItem = {
  path: string;
  label: string;
  icon: SidebarIcon;
};

const MAIN_MENU: MenuItem[] = [
  { path: "/home", label: "Home", icon: IconHome },
  { path: "/invoices", label: "Invoices", icon: InvoiceIcone },
  { path: "/estimates", label: "Estimates", icon: IconEstimates },
  { path: "/estimates/ai", label: "Estimates AI", icon: Sparkles },
  // { path: "/emails", label: "Emails", icon: Mail },
  // { path: "/automated-sequences", label: "Automated Sequences", icon: Workflow },
  // { path: "/review-queue", label: "Review Queue", icon: Sparkles },
  // { path: "/tasks", label: "Tasks & Calendar", icon: Calendar },
  { path: "/clients", label: "Clients", icon: UserEdition },
  { path: "/products", label: "Products", icon: IconProduto },
  { path: "/user/myprofile", label: "Settings", icon: SettingIcon },
];

const OTHER_MENU: MenuItem[] = [
  { path: "/user/support", label: "Client Support", icon: Headphones },
];

function NavIcon({ icon: Icon }: { icon: SidebarIcon }) {
  return (
    <span className="flex shrink-0 items-center justify-center w-6 h-6 text-inherit">
      <Icon className="size-6 shrink-0" aria-hidden />
    </span>
  );
}

const Sidebar = ({ onClose }: { onClose?: () => void }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleItemClick = (path: string) => {
    navigate(path);
    if (onClose) onClose();
  };

  const isActive = (path: string) => location.pathname === path;

  const baseItem =
    "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all";
  const activeItem = "bg-blue-50 text-primary font-semibold";
  const inactiveItem = "text-gray-600 hover:bg-gray-100 hover:text-primary";

  const renderMenuItem = ({ path, label, icon }: MenuItem) => (
    <li
      key={path}
      className={`${baseItem} ${isActive(path) ? activeItem : inactiveItem}`}
      onClick={() => handleItemClick(path)}
    >
      <NavIcon icon={icon} />
      <span>{label}</span>
    </li>
  );

  return (
    <aside
      className={`w-60 h-full bg-white flex flex-col overflow-hidden ${
        onClose ? "bg-gray-50" : ""
      }`}
    >
      <div className="flex-1 px-3 py-4 space-y-6">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
            Main Menu
          </p>
          <ul className="space-y-1">{MAIN_MENU.map(renderMenuItem)}</ul>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
            Others
          </p>
          <ul className="space-y-1">{OTHER_MENU.map(renderMenuItem)}</ul>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
