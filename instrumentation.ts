import type { Instrumentation } from "next";
import { recordSchoolRequestError } from "./lib/school-error-monitor.ts";
/** Next and Vinext call this only for server request errors. The request is ignored. */
export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  recordSchoolRequestError(error, context);
};
