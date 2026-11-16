import { Router } from "express";
import { successResponse } from "../../common/utils/response/success.response.js";
import {
  confirmEmail,
  confirmLogin,
  ContinueWithGoogle,
  forgotPassword,
  login,
  resendConfirmEmail,
  resetPassword,
  signup,
  twoFactorEnableConfirm,
  twoFactorEnableRequest,
} from "./auth.service.js";
import {
  confirmEmailSchema,
  loginSchema,
  resendConfirmEmailSchema,
  signupSchema,
} from "./auth.validation.js";
import { BadException } from "../../common/exceptions/error.exception.js";
import { validation } from "../../middleware/validation.middleware.js";
import { authentication } from "../../middleware/auth.middleware.js";
const router = Router();

router.post("/signup", validation(signupSchema), async (req, res, next) => {
  const result = await signup(req.validate);
  return successResponse({ res, status: 201, data: result });
});

router.patch("/verify-account", async (req, res, next) => {
  const result = await confirmEmail(req.body);
  return successResponse({ res, message: "Account verified successfully" });
});

router.patch("/resend-confirm-email", async (req, res, next) => {
  const result = await resendConfirmEmail(req.body);
  return successResponse({ res, message: "otp resend successfully" });
});

router.post("/login", validation(loginSchema), async (req, res, next) => {
  const result = await login(req.validate, `${req.protocol}://${req.host}`);
  return successResponse({ res, data: result });
});

router.post("/signup/gmail", async (req, res, next) => {
  console.log({ body: req.body });
  const { status, credentials } = await ContinueWithGoogle(
    req.body,
    `${req.protocol}://${req.host}`,
  );
  return successResponse({
    res,
    status: status,
    message: "Done",
    data: credentials,
  });
});

router.post("/request-enable-2fa", authentication(), async (req, res, next) => {
  const result = await twoFactorEnableRequest(req.user);
  return successResponse({ res, message: "otp sent successfully" });
});

router.patch(
  "/confirm-enable-2fa",
  authentication(),
  async (req, res, next) => {
    const result = await twoFactorEnableConfirm(req.user, req.body);
    return successResponse({
      res,
      message: "Two step verification enabled successfully",
    });
  },
);

router.post("/confirm-login", async (req, res, next) => {
  const result = await confirmLogin(req.body, `${req.protocol}://${req.host}`);
  return successResponse({ res, data: result });
});

router.post("/forgot-password", async (req, res, next) => {
  const result = await forgotPassword(req.body);
  return successResponse({
    res,
    message: "Reset password link sent to your email",
  });
});

router.patch("/reset-password/:token", async (req, res, next) => {
  const result = await resetPassword(req.params.token, req.body.password);
  return successResponse({ res, message: "Reset password successfully" });
});
export default router;
