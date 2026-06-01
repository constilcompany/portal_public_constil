import React from "react";
import { Info, UserRoundPenIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import SubscriptionIcon from "../../assets/icons/subscriptionIcon";

export function MyProfileAside() {
    const otherRoutes = [
        { path: '/user/subscriptions', label: 'Subscriptions', icon: <SubscriptionIcon /> },
        { path: '/user/company', label: 'Company', icon: <Info /> }
    ];

    const linkBaseClasses =
        "flex flex-1 lg:flex-none flex-col gap-1 text-[11px] font-medium px-2 py-2.5 rounded-lg cursor-pointer text-center " +
        "lg:flex-row lg:text-left lg:gap-2 lg:text-base lg:p-2 lg:rounded-md transition-colors duration-200";

    const activeClasses = "bg-[#448AFF] text-white lg:text-[#448AFF] lg:bg-transparent";
    const inactiveClasses = "bg-[#1E293B] text-white lg:text-white lg:bg-transparent hover:bg-[#2c3e50]";

    return (
        <section className="flex flex-col lg:flex-row items-stretch lg:items-start gap-3 sm:gap-4 lg:gap-5 p-3 sm:p-4 lg:p-2 h-auto lg:h-[100vh] rounded-lg">
            <div className="bg-[#0F172A] p-3 sm:p-4 h-full border-none rounded-lg flex flex-row lg:flex-col gap-2 sm:gap-3 lg:gap-1 w-full">
                <span className="hidden lg:block font-medium text-xs text-white opacity-50 uppercase mb-2">
                    Menu
                </span>

                <NavLink
                    to={'/user/myprofile'}
                    className={({ isActive }) =>
                        twMerge(linkBaseClasses, isActive ? activeClasses : inactiveClasses)
                    }
                >
                    <UserRoundPenIcon className="w-5 h-5 lg:w-6 lg:h-6" />
                    <span>My Profile</span>
                </NavLink>

                <span className="hidden lg:block font-medium text-xs text-white opacity-50 mt-8 mb-2 uppercase">
                    Other Options
                </span>
                {otherRoutes.map((route) => (
                    <NavLink
                        key={route.path}
                        to={route.path}
                        className={({ isActive }) =>
                            twMerge(linkBaseClasses, isActive ? activeClasses : inactiveClasses)
                        }
                    >
                        {React.cloneElement(route.icon, { className: "w-5 h-5 lg:w-6 lg:h-6" })}
                        <span>{route.label}</span>
                    </NavLink>
                ))}
            </div>
        </section>
    );
}
