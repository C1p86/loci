import { createBrowserRouter, Navigate } from 'react-router-dom';
import { publicOnlyLoader } from './guards.js';
import { ForgotPassword } from './public/ForgotPassword.js';
import { InviteAccept } from './public/InviteAccept.js';
import { Login } from './public/Login.js';
import { NotFound } from './public/NotFound.js';
import { ResetPassword } from './public/ResetPassword.js';
import { Signup } from './public/Signup.js';
import { VerifyEmail } from './public/VerifyEmail.js';
import { RootLayout, rootLoader } from './RootLayout.js';

export const router = createBrowserRouter([
  { path: '/login', element: <Login />, loader: publicOnlyLoader },
  { path: '/signup', element: <Signup />, loader: publicOnlyLoader },
  { path: '/forgot-password', element: <ForgotPassword />, loader: publicOnlyLoader },
  { path: '/reset-password/:token', element: <ResetPassword /> },
  { path: '/verify-email/:token', element: <VerifyEmail /> },
  { path: '/invites/:token', element: <InviteAccept /> },
  {
    path: '/',
    element: <RootLayout />,
    loader: rootLoader,
    children: [
      { index: true, element: <Navigate to="/agents" replace /> },
      // Feature routes wired in Plans 13-03/04/05
      { path: '*', element: <NotFound /> },
    ],
  },
]);
