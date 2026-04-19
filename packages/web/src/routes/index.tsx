import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AgentsList } from './agents/AgentsList.js';
import { publicOnlyLoader } from './guards.js';
import { HistoryList } from './history/HistoryList.js';
import { ForgotPassword } from './public/ForgotPassword.js';
import { InviteAccept } from './public/InviteAccept.js';
import { Login } from './public/Login.js';
import { NotFound } from './public/NotFound.js';
import { ResetPassword } from './public/ResetPassword.js';
import { Signup } from './public/Signup.js';
import { VerifyEmail } from './public/VerifyEmail.js';
import { RootLayout, rootLoader } from './RootLayout.js';
import { RunDetail } from './runs/RunDetail.js';
import { TaskEditor } from './tasks/TaskEditor.js';
import { TasksList } from './tasks/TasksList.js';
import { TaskTrigger } from './tasks/TaskTrigger.js';

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
      { path: 'agents', element: <AgentsList /> },
      { path: 'tasks', element: <TasksList /> },
      { path: 'tasks/:id/edit', element: <TaskEditor /> },
      { path: 'tasks/:id/trigger', element: <TaskTrigger /> },
      { path: 'runs/:id', element: <RunDetail /> },
      { path: 'history', element: <HistoryList /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
