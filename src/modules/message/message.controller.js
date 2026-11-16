import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import {
  acceptRequest,
  getRecievedMessages,
  getRequests,
  rejectRequest,
  requestSenderIdentity,
  sendAnonymousMessage,
} from "./message.service.js";
import { successResponse } from "../../common/utils/response/success.response.js";
const router = Router();

router.post("/:recieverId", authentication(), async (req, res, next) => {
  const result = await sendAnonymousMessage(
    req.user._id,
    req.params.recieverId,
    req.body.content,
  );
  return successResponse({
    res,
    status: 201,
    message: "Anonymous message sent successfully",
    data: result,
  });
});

router.get("/received", authentication(), async (req, res, next) => {
  const result = await getRecievedMessages(req.user._id);
  return successResponse({ res, data: result });
});

router.post(
  "/:messageId/identity-request",
  authentication(),
  async (req, res, next) => {
    const result = await requestSenderIdentity(
      req.user._id,
      req.params.messageId,
    );
    return successResponse({
      res,
      status: 201,
      message: "Request for sender identity sent successfully",
      data: result,
    });
  },
);

router.get("/identity-requests", authentication(), async (req, res, next) => {
  const result = await getRequests(req.user._id);
  return successResponse({ res, data: result });
});

router.patch(
  "/identity-request/:requestId/reject",
  authentication(),
  async (req, res, next) => {
    const result = await rejectRequest(req.params.requestId, req.user._id);
    return successResponse({
      res,
      message: "request rejected successfully",
      data: result,
    });
  },
);

router.patch(
  "/identity-request/:requestId/accept",
  authentication(),
  async (req, res, next) => {
    const result = await acceptRequest(req.params.requestId, req.user._id);
    return successResponse({
      res,
      message: "request accepted successfully",
      data: result,
    });
  },
);
export default router;
