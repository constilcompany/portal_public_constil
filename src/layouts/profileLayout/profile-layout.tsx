import { Outlet } from "react-router-dom";
import { MyProfileAside } from "../../components/myProfile/my-profile-aside";

export function ProfileLayout() {
  return (
    <section className="flex flex-col lg:flex-row gap-4 sm:gap-5 lg:gap-0 min-h-screen w-full bg-gray-50">
      <MyProfileAside />
      <div className="flex-1 px-4 sm:px-5 lg:px-6 pb-5 lg:pb-0 overflow-y-auto max-h-[100vh]">
        <div className="pt-2 sm:pt-3 lg:pt-0">
          <Outlet />
        </div>
      </div>
    </section>
  );
}
