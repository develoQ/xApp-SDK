import { EventEmitter } from "events";

import {
  AnyJson,
  xAppEvent,
  xAppActionNavigate,
  xAppActionOpenSignRequest,
  xAppActionOpenBrowser,
  xAppActionTxDetails,
  xAppActionClose,
  xAppEvents,
  xAppReceivedEvent,
  xAppReceivedEventData,
  payloadEventData,
  qrEventData,
  destinationEventData,
  xAppDomWindow,
} from "./types";

export * from "./types";

// localStorage.debug = "xapp*";

const docMinAliveSec = 1;
const attemptMs = 250;
const attemptDuration = 2000;

const appStart = Number(new Date());

let documentIsReady: (value?: unknown) => void;
const documentReadyPromise = new Promise((resolve) => {
  documentIsReady = (value) => {
    console.log("Doc Ready...");
    const timeSinceDocLoad = (Number(new Date()) - appStart) / 1000;
    if (timeSinceDocLoad < docMinAliveSec /* Seconds */) {
      // Stall
      console.log(
        "Doc not alive >= " +
          docMinAliveSec +
          " sec, stalling for " +
          (docMinAliveSec - timeSinceDocLoad)
      );
      setTimeout(function () {
        resolve(value);
      }, (docMinAliveSec - timeSinceDocLoad) * 1000);
    } else {
      // Go ahead
      console.log("Doc alive " + docMinAliveSec + "+ sec, go ahead");
      resolve(value);
    }
  };
});

documentReadyPromise
  .then(() => {
    console.log("documentReadyPromise resolved");
  })
  .catch((e) => {
    console.log(e);
  });

document.addEventListener("readystatechange", (event) => {
  console.log("(readystatechange: [ " + document.readyState + " ])");
  if (document.readyState === "complete") {
    documentIsReady();
  }
});

console.log("Loading xApp SDK");

export declare interface xApp {
  on<U extends keyof xAppEvent>(event: U, listener: xAppEvent[U]): this;
  off<U extends keyof xAppEvent>(event: U, listener: xAppEvent[U]): this;
  // emit<U extends keyof xAppEvent>(
  //   event: U,
  //   ...args: Parameters<xAppEvent[U]>
  // ): boolean;
}

let _window = window as xAppDomWindow;
let isSandbox = false;
if (_window?.parent) {
  // XAPP PROXY
  _window.parent?.postMessage("XAPP_PROXY_INIT", "*");
}

const xAppActionAttempt = async (
  command: string,
  options?:
    | xAppActionNavigate
    | xAppActionOpenSignRequest
    | xAppActionOpenBrowser
    | xAppActionClose
    | xAppActionTxDetails
    | AnyJson,
  attempt = 0
): Promise<boolean | Error> => {
  await documentReadyPromise;

  if (typeof _window?.ReactNativeWebView !== "undefined" || isSandbox) {
    const timeSinceDocLoad = (Number(new Date()) - appStart) / 1000;

    if (["close"].indexOf(command) > -1) {
      // Close command awaits app nav state, min sec. alive 4
      const minAliveTimeSec = 4;
      if (timeSinceDocLoad < minAliveTimeSec) {
        console.log(
          "xApp close, doc alive < minAliveTimeSec, stall: " +
            (minAliveTimeSec - timeSinceDocLoad)
        );
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve(true);
          }, (minAliveTimeSec - timeSinceDocLoad) * 1000);
        });
      }
    }

    const msgToPost = JSON.stringify({ command, ...(options || {}) });

    if (isSandbox) {
      _window.parent?.postMessage(msgToPost, "*");
    } else {
      _window.ReactNativeWebView?.postMessage(msgToPost);
    }
    console.log("xAppActionAttempt Success", command, options);

    return true;
  } else {
    if (attempt * attemptMs < attemptDuration) {
      // Another attempt
      console.log(
        "xAppActionAttempt Attempt " + attempt + " » Retry",
        command,
        options
      );
      await new Promise((resolve) => {
        setTimeout(resolve, attemptMs);
      });
      return xAppActionAttempt(command, options, attempt + 1);
    } else {
      // Nope
      console.log(
        "xAppActionAttempt Failed after attempt " + attempt,
        command,
        options
      );

      return new Error(
        "xApp." +
          command.replace(/^xApp/, "") +
          ": could not contact Xumm App Host"
      );
    }
  }
};

class xAppThread extends EventEmitter {
  constructor() {
    super();

    if (document.readyState === "complete") {
      documentIsReady();
    }

    const eventHandler = (event: Event): void => {
      const rEvent = event as xAppReceivedEvent;

      if (
        typeof rEvent?.data === "string" &&
        rEvent.data === "XAPP_PROXY_INIT_ACK"
      ) {
        console.log(
          "xApp Proxy ACK received, switching to PROXY (SANDBOX) mode"
        );
        isSandbox = true;
        return;
      }

      try {
        const _event: xAppReceivedEventData = JSON.parse(rEvent?.data || "{}");

        console.log({ _event });

        if (typeof _event === "object" && _event !== null) {
          if (
            typeof _event.method === "string" &&
            _event.method in xAppEvents
          ) {
            console.log("xApp Event received", _event.method, _event);

            const method = _event.method;
            delete _event.method;

            switch (method) {
              case String(xAppEvents.payloadResolved):
                this.emit("payload", _event as unknown as payloadEventData);
                break;
              case String(xAppEvents.scanQr):
                this.emit("qr", _event as unknown as qrEventData);
                break;
              case String(xAppEvents.selectDestination):
                this.emit(
                  "destination",
                  _event as unknown as destinationEventData
                );
                break;
            }
          } else {
            console.log(
              "xApp Event received, not in xAppEvents",
              _event.method,
              xAppEvents
            );
          }
        }
      } catch (e) {
        console.log(
          "xApp Event received, cannot parse as JSON",
          (e as Error).message
        );
      }
    };

    if (typeof window.addEventListener === "function") {
      window.addEventListener("message", eventHandler);
    }

    if (typeof document.addEventListener === "function") {
      document.addEventListener("message", eventHandler);
    }
  }

  navigate(navigateOptions: xAppActionNavigate): Promise<boolean | Error> {
    if (typeof navigateOptions?.xApp !== "string") {
      return Promise.reject(
        new Error("xApp.navigate: Invalid argument: `xApp`")
      );
    }
    return xAppActionAttempt("xAppNavigate", navigateOptions);
  }

  openSignRequest(
    openSignRequestOptions: xAppActionOpenSignRequest
  ): Promise<boolean | Error> {
    if (typeof openSignRequestOptions?.uuid !== "string") {
      return Promise.reject(
        new Error("xApp.openSignRequest: Invalid argument: `uuid`")
      );
    }
    if (
      !openSignRequestOptions.uuid.match(
        /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
      )
    ) {
      return Promise.reject(
        new Error("xApp.openSignRequest: Invalid payload UUID")
      );
    }
    return xAppActionAttempt("openSignRequest", openSignRequestOptions);
  }

  selectDestination(): Promise<boolean | Error> {
    return xAppActionAttempt("selectDestination");
  }

  openBrowser(
    openBrowserOptions: xAppActionOpenBrowser
  ): Promise<boolean | Error> {
    if (typeof openBrowserOptions?.url !== "string") {
      return Promise.reject(
        new Error("xApp.openBrowser: Invalid argument: `url`")
      );
    }
    return xAppActionAttempt("openBrowser", openBrowserOptions);
  }

  scanQr(): Promise<boolean | Error> {
    return xAppActionAttempt("scanQr");
  }

  tx(txOptions: xAppActionTxDetails): Promise<boolean | Error> {
    if (typeof txOptions?.tx !== "string") {
      return Promise.reject(new Error("xApp.tx: Invalid argument: `tx`"));
    }
    if (typeof txOptions?.account !== "string") {
      return Promise.reject(new Error("xApp.tx: Invalid argument: `account`"));
    }
    return xAppActionAttempt("txDetails", txOptions);
  }

  close(closeOptions?: xAppActionClose): Promise<boolean | Error> {
    return xAppActionAttempt("close", closeOptions);
  }

  customCommand(
    customCommand: string,
    customCommandOptions?: AnyJson
  ): Promise<boolean | Error> {
    return xAppActionAttempt(customCommand, customCommandOptions);
  }
}

const thread = (_xApp?: xAppThread): xAppThread => {
  let attached = false;
  if (_xApp) {
    if (typeof _window === "object") {
      if (typeof (_window as any)._xAppSdk === "undefined") {
        (_window as any)._xAppSdk = _xApp;
        attached = true;
      }
    }
  }

  const instance = (_window as any)._xAppSdk;

  if (instance && attached) {
    console.log("xAppSdk attached to window");
  }

  return instance;
};

export class xApp {
  constructor() {
    if (!thread()) {
      thread(new xAppThread());
    }
  }

  on<U extends keyof xAppEvent>(event: U, listener: xAppEvent[U]) {
    thread().on(event, listener);
    return this;
  }

  off<U extends keyof xAppEvent>(event: U, listener: xAppEvent[U]) {
    thread().off(event, listener);
    return this;
  }

  navigate(navigateOptions: xAppActionNavigate): Promise<boolean | Error> {
    return thread().navigate(navigateOptions);
  }

  openSignRequest(
    openSignRequestOptions: xAppActionOpenSignRequest
  ): Promise<boolean | Error> {
    return thread().openSignRequest(openSignRequestOptions);
  }

  selectDestination(): Promise<boolean | Error> {
    return thread().selectDestination();
  }

  openBrowser(
    openBrowserOptions: xAppActionOpenBrowser
  ): Promise<boolean | Error> {
    return thread().openBrowser(openBrowserOptions);
  }

  scanQr(): Promise<boolean | Error> {
    return thread().scanQr();
  }

  tx(txOptions: xAppActionTxDetails): Promise<boolean | Error> {
    return thread().tx(txOptions);
  }

  close(closeOptions?: xAppActionClose): Promise<boolean | Error> {
    return thread().close(closeOptions);
  }

  customCommand(
    customCommand: string,
    customCommandOptions?: AnyJson
  ): Promise<boolean | Error> {
    return thread().customCommand(customCommand, customCommandOptions);
  }
}
