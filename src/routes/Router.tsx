import { Route, Routes } from 'react-router-dom';
import { InvoiceNavLayout } from '../layouts/invoices-nav-layout/invoices-nav-layout';
import Layout from '../layouts/layout';
import { Products } from '../pages/products';
import { NewProduct } from '../pages/products/newproduct/newproct';
import { ForgotPassword } from '../pages/auth/forgot-password';
import { Login } from '../pages/auth/login';
import { ResetPassword } from '../pages/auth/reset-password';
import { ResetSent } from '../pages/auth/reset-sent';
import { VerifyOtp } from '../pages/auth/verify-otp';
import { Singup } from '../pages/auth/singup';
import { Clintes } from '../pages/clients/clients';
import { Home } from '../pages/home/home';
import { ClientSupport } from '../pages/clientsupport/client-support';
import { NewInvoiceEstimate } from '../pages/invoiceestimate/estimetes';
import { EstimateCreated } from '../pages/listestimatecreated/estimared-creat';
import { ListInvoice } from '../pages/listinvoicecreated/listein-voice-created';
import { NewClient } from '../pages/newclinte/new-client';
import { NewInvoice } from '../pages/newinvoice/new-invoices';
import { SendInvoices } from '../pages/sendinvoice/send-invoice';
import { PrivateRoute } from './private-routes';
import ViewsEstimateComponent from '../components/viewsestimated/viewsetimate';
import { MyProfile } from '../pages/profile/my-profile';
import { ProfileLayout } from '../layouts/profileLayout/profile-layout';
import { Subscription } from '../pages/profile/subscription';
import { SubscriptionStatus } from '../pages/profile/subscription-status';
import { UnauthenticatedRoute } from './unauthenticated-route';
import { Welcome } from '../pages/onboarding/welcome/welcome';
import WelcomeLayout from '../layouts/welcomeLayout/welcome-layout';
import { SingUpBusinessStep } from '../components/singUp/signUp-business-step';
import SubscriptionPage from '../pages/onboarding/subscription/subscription-page';
import { InvoiceNavLayoutTwo } from '../layouts/invoices-nav-two-layout/invoices-nav-two-layout';
import { Contact } from '../pages/contact/contact';
import { AiInvoice } from '../pages/aiinvoice/ai-invoices';
import Notifiction from '../pages/notifiction/notification';
// import { AiEstimate } from '../pages/aiestimate/ai-estimate';
import CreateProjectWizard from '../pages/ai-estimate-pages/main-wrapper';
import AiEstimateList from '../pages/ai-estimate-pages/AiEstimateList';
import File from '../pages/ai-estimate-pages/File';
import NotFound from '../pages/404/not-found';
import ServerErrorPage from '../pages/404/server-error';
import Company from '../pages/support/company';
import Descriptive from '../pages/descriptive/descriptive-info';
import UpdatePassword from '../pages/updatepassword/update-password';
import PaymentSuccess from '../pages/payment-success/payment-success';
import { AuthCallback } from '../pages/nylas/AuthCallback';
import { Emails } from '../pages/emails/Emails';
import { ReviewQueue } from '../pages/email-intelligence/ReviewQueue';
import { TasksCalendar } from '../pages/email-intelligence/TasksCalendar';
import AutomatedSequences from '../pages/automated-sequences';

export function Router() {
  return (
    <Routes>
      <Route path="/" element={<UnauthenticatedRoute children={<Login />} />} />
      <Route path="/signup" element={<UnauthenticatedRoute children={<Singup />} />} />

      <Route path="/forgotpassword" element={<ForgotPassword />} />
      <Route path="/server-error" element={<ServerErrorPage />} />
      <Route path="*" element={<NotFound />} />

      <Route path="/verify-otp" element={<VerifyOtp />} />
      <Route path="/reset" element={<ResetSent />} />
      <Route path="/resetpassword" element={<ResetPassword />} />

      <Route element={<PrivateRoute />}>
        <Route element={<WelcomeLayout />}>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/user/detail" element={<SingUpBusinessStep />} />
          <Route path="/subscribe" element={<SubscriptionPage />} />
        </Route>
        <Route path="/payment-success" element={<PaymentSuccess />} />
        <Route path="/auth/nylas/callback" element={<AuthCallback />} />


        <Route element={<Layout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/notification" element={<Notifiction />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/new" element={<NewProduct />} />
          <Route path="/discriptive/info" element={<Descriptive />} />
          <Route path="/clients" element={<Clintes />} />
          <Route path="/newCliente" element={<NewClient />} />
          <Route path="/user/myprofile" element={<MyProfile />} />
          // @ts-ignore
          <Route path="/estimates/ai" element={<AiEstimateList />} />
          <Route path="/estimates/ai/steps" element={<CreateProjectWizard />} />
          <Route path="/estimates/ai/file" element={<File />} />
          <Route path="/emails" element={<Emails />} />
          <Route path="/automated-sequences" element={<AutomatedSequences />} />
          <Route path="/review-queue" element={<ReviewQueue />} />
          <Route path="/tasks" element={<TasksCalendar />} />

          <Route path="/estimates" element={<InvoiceNavLayout />}>
            <Route index element={<EstimateCreated />} />
            <Route path="new" element={<NewInvoiceEstimate />} />
            <Route path="support" element={<ClientSupport />} />
            <Route path="detail" element={<ViewsEstimateComponent title="Estimate" />} />
          </Route>

          <Route path="/invoices" element={<InvoiceNavLayoutTwo />}>
            <Route index element={<ListInvoice />} />
            <Route path="support" element={<ClientSupport />} />
            <Route path="new" element={<NewInvoice />} />
            <Route path="ai" element={<AiInvoice />} />
            <Route path="share" element={<SendInvoices />} />
            <Route path="detail" element={<ViewsEstimateComponent title="Invoice" />} />
          </Route>

          <Route path="/user" element={<ProfileLayout />}>
            <Route index path="myprofile" element={<MyProfile />} />
            <Route index path="company" element={<Company />} />
            <Route index path="support" element={<Contact />} />
            <Route index path="update_password" element={<UpdatePassword />} />
            <Route path="subscriptions">
              <Route index element={<Subscription />} />
              <Route path="status" element={<SubscriptionStatus />} />
            </Route>

            <Route path="policy" element={<MyProfile />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
