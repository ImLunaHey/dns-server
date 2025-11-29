import { ComponentPlaygroundConfig } from "./playground.types";
import { ErrorPage } from "./ErrorPage";

export const ErrorPagePlayground = {
  name: "ErrorPage" as const,
  controls: [
    {
      key: "errorType" as const,
      label: "Error Type",
      type: "select" as const,
      options: [
        { label: "404 Not Found", value: "404" as const },
        { label: "500 Server Error", value: "500" as const },
        { label: "Custom Error", value: "custom" as const },
      ],
      defaultValue: "404" as const,
    },
    {
      key: "errorMessage" as const,
      label: "Error Message",
      type: "text" as const,
      defaultValue: "The page you're looking for doesn't exist.",
    },
    {
      key: "showDetails" as const,
      label: "Show Error Details",
      type: "toggle" as const,
      defaultValue: false,
    },
  ],
  render: (props) => {
    const errorType = props.errorType as string;
    let error: (Error & { status?: number }) | undefined;

    if (errorType === "404") {
      error = {
        name: "NotFoundError",
        message: props.errorMessage as string,
        status: 404,
      } as Error & { status: number };
    } else if (errorType === "500") {
      error = {
        name: "ServerError",
        message: props.errorMessage as string,
        status: 500,
      } as Error & { status: number };
    } else {
      error = {
        name: "Error",
        message: props.errorMessage as string,
        stack: props.showDetails
          ? "Error: Custom error\n    at ErrorPage (ui-components.tsx:1:1)\n    at render (ui-components.tsx:1:1)"
          : undefined,
      } as Error;
    }

    return <ErrorPage error={error} />;
  },
  codeGen: (props) => {
    const errorType = props.errorType as string;
    let errorCode = "";

    if (errorType === "404") {
      errorCode = `const error = { status: 404, message: "${props.errorMessage}" };`;
    } else if (errorType === "500") {
      errorCode = `const error = { status: 500, message: "${props.errorMessage}" };`;
    } else {
      errorCode = `const error = new Error("${props.errorMessage}");`;
    }

    return `${errorCode}\n<ErrorPage error={error} />`;
  },
} satisfies ComponentPlaygroundConfig;

