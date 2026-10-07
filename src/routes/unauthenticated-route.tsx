/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";

import { oauthReturnPath } from '../pages/auth/oauth-return';

interface Props {
  children: ReactNode;
}

export function UnauthenticatedRoute({ children }: Props) {
  const location = useLocation();
  // @ts-ignore
  const { token } = useSelector((state) => state.auth);

  if (token) {
    return <Navigate to={oauthReturnPath(location.search)} replace />;
  }

  return children;
}
