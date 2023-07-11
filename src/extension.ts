import * as vscode from "vscode";
import { HfInference } from "@huggingface/inference";
import streamInference from "./streamInference";
const fetch = require("node-fetch-polyfill");

type AuthInfo = { apiKey?: string };
type ApiURL = {
  explain?: string;
  refactor?: string;
  findProblems?: string;
  optimize?: string;
  documentation?: string;
};
type Settings = {
  apiUrl?: ApiURL;
  maxNewTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
};

const BASE_URL = "http://localhost:8100/code/explain";

// The number of OPERATION_COUNT should match the keys in the type ApiURL count. Meaning one api endpoint per operation
const OPERATION_COUNT = 5;

export function activate(context: vscode.ExtensionContext) {
  console.log('activating extension "chatgpt"');
  // Get the settings from the extension's configuration
  const config = vscode.workspace.getConfiguration("starchat");

  console.log(config);

  // Create a new TextGenerationViewProvider instance and register it with the extension's context
  const provider = new TextGenerationViewProvider(context.extensionUri);

  // Put configuration settings into the provider
  provider.setAuthenticationInfo({
    apiKey: config.get("apiKey"),
  });
  provider.setSettings({
    apiUrl: {
      explain: config.get("apiUrl.explain") || BASE_URL,
      refactor: config.get("apiUrl.refactor") || BASE_URL,
      findProblems: config.get("apiUrl.findProblems") || BASE_URL,
      optimize: config.get("apiUrl.optimize") || BASE_URL,
      documentation: config.get("apiUrl.documentation") || BASE_URL,
    },
    maxNewTokens: config.get("maxNewTokens") || 1024,
    temperature: config.get("temperature") || 0.2,
    topK: config.get("topK") || 50,
    topP: config.get("topP") || 0.95,
  });

  // Register the provider with the extension's context
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TextGenerationViewProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      }
    )
  );

  const commandHandler = (command: string) => {
    const config = vscode.workspace.getConfiguration("starchat");
    const prompt = config.get(command) as string;
    provider.search(prompt, command);
  };

  // Register the commands that can be called from the extension's package.json
  context.subscriptions.push(
    vscode.commands.registerCommand("chatgpt.explain", () =>
      commandHandler("promptPrefix.explain")
    ),
    vscode.commands.registerCommand("chatgpt.refactor", () =>
      commandHandler("promptPrefix.refactor")
    ),
    vscode.commands.registerCommand("chatgpt.optimize", () =>
      commandHandler("promptPrefix.optimize")
    ),
    vscode.commands.registerCommand("chatgpt.findProblems", () =>
      commandHandler("promptPrefix.findProblems")
    ),
    vscode.commands.registerCommand("chatgpt.documentation", () =>
      commandHandler("promptPrefix.documentation")
    )
  );

  // Change the extension's session token or settings when configuration is changed
  vscode.workspace.onDidChangeConfiguration(
    (event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("starchat.apiKey")) {
        const config = vscode.workspace.getConfiguration("starchat");
        provider.setAuthenticationInfo({ apiKey: config.get("apiKey") });
      } else if (event.affectsConfiguration("starchat.apiUrl.explain")) {
        const config = vscode.workspace.getConfiguration("starchat");
        let url = config.get("apiUrl.explain") as string; // || BASE_URL;
        provider.setSettings({ apiUrl: { explain: url } });
      } else if (event.affectsConfiguration("starchat.apiUrl.refactor")) {
        const config = vscode.workspace.getConfiguration("starchat");
        let url = config.get("apiUrl.refactor") as string; // || BASE_URL;
        provider.setSettings({ apiUrl: { refactor: url } });
      } else if (event.affectsConfiguration("starchat.apiUrl.findProblems")) {
        const config = vscode.workspace.getConfiguration("starchat");
        let url = config.get("apiUrl.findProblems") as string; // || BASE_URL;
        provider.setSettings({ apiUrl: { findProblems: url } });
      } else if (event.affectsConfiguration("starchat.apiUrl.optimize")) {
        const config = vscode.workspace.getConfiguration("starchat");
        let url = config.get("apiUrl.optimize") as string; // || BASE_URL;
        provider.setSettings({ apiUrl: { optimize: url } });
      } else if (event.affectsConfiguration("starchat.apiUrl.documentation")) {
        const config = vscode.workspace.getConfiguration("starchat");
        let url = config.get("apiUrl.documentation") as string; // || BASE_URL;
        provider.setSettings({ apiUrl: { documentation: url } });
      } else if (event.affectsConfiguration("starchat.maxNewTokens")) {
        const config = vscode.workspace.getConfiguration("starchat");
        provider.setSettings({ maxNewTokens: config.get("maxNewTokens") });
      } else if (event.affectsConfiguration("starchat.temperature")) {
        const config = vscode.workspace.getConfiguration("starchat");
        provider.setSettings({ temperature: config.get("temperature") });
      } else if (event.affectsConfiguration("starchat.topK")) {
        const config = vscode.workspace.getConfiguration("starchat");
        provider.setSettings({ topK: config.get("topK") });
      } else if (event.affectsConfiguration("starchat.topP")) {
        const config = vscode.workspace.getConfiguration("starchat");
        provider.setSettings({ topP: config.get("topP") });
      }
    }
  );
}

class TextGenerationViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "chatgpt.chatView";
  private _view?: vscode.WebviewView;
  private _chatGPTAPI?: HfInference;

  private _response?: string;
  private _prompt?: string;
  private _fullPrompt?: string;
  private _currentMessageNumber = 0;

  private _settings: Settings = {
    apiUrl: {
      explain: BASE_URL,
      refactor: BASE_URL,
      findProblems: BASE_URL,
      optimize: BASE_URL,
      documentation: BASE_URL,
    },
    maxNewTokens: 1024,
    temperature: 0.2,
    topK: 50,
    topP: 0.95,
  };

  private _authInfo?: AuthInfo;

  // In the constructor, we store the URI of the extension
  constructor(private readonly _extensionUri: vscode.Uri) {}

  // Set the API key and create a new API instance based on this key
  public setAuthenticationInfo(authInfo: AuthInfo) {
    this._authInfo = authInfo;
    this._newAPI();
  }

  public setSettings(settings: Settings) {
    let changeModel = false;
    if (settings.apiUrl) {
      changeModel = true;
      this._settings.apiUrl = { ...this._settings.apiUrl, ...settings.apiUrl };
    } else {
      this._settings = { ...this._settings, ...settings };
    }

    if (changeModel) {
      this._newAPI();
    }
  }

  public getSettings() {
    return this._settings;
  }

  private _isApiUrlValid(apiUrl: ApiURL | undefined): boolean {
    if (!apiUrl) {
      return false; // Object is undefined
    }

    const expectedKeysCount = OPERATION_COUNT;
    const actualKeys = Object.keys(apiUrl);

    if (actualKeys.length !== expectedKeysCount) {
      return false; // Object does not have all the keys
    }

    for (const key of actualKeys) {
      const value = apiUrl[key as keyof ApiURL];

      if (value === null || value === undefined || value.trim() === "") {
        return false; // Value is null, undefined, or empty
      }
    }

    return true; // All keys have valid values
  }

  private _getOperationEndpoint(command: string): string {
    const config = vscode.workspace.getConfiguration("starchat");

    let endpoint = "";

    switch (command) {
      case "promptPrefix.explain":
        endpoint = config.get("apiUrl.explain") as string;
        break;
      case "promptPrefix.refactor":
        endpoint = config.get("apiUrl.refactor") as string;
        break;
      case "promptPrefix.findProblems":
        endpoint = config.get("apiUrl.findProblems") as string;
        break;
      case "promptPrefix.optimize":
        endpoint = config.get("apiUrl.optimize") as string;
        break;
      case "promptPrefix.documentation":
        endpoint = config.get("apiUrl.documentation") as string;
        break;
      default:
        break;
    }

    return endpoint;
  }

  // This private method initializes a new ChatGPTAPI instance
  private _newAPI() {
    if (!this._authInfo || !this._isApiUrlValid(this._settings.apiUrl)) {
      console.warn(
        "API key or API URLs not set, please go to extension settings (read README.md for more info)"
      );
      this._chatGPTAPI = undefined;
    } else {
      console.log("api key is", this._authInfo.apiKey);
      this._chatGPTAPI = new HfInference(this._authInfo.apiKey || "xx");
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    // set options for the webview, allow scripts
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // set the HTML for the webview
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // add an event listener for messages received by the webview
    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case "codeSelected": {
          let code = data.value;
          const snippet = new vscode.SnippetString();
          snippet.appendText(code);
          // insert the code as a snippet into the active text editor
          vscode.window.activeTextEditor?.insertSnippet(snippet);
          break;
        }
        case "prompt": {
          this.search(data.value);
        }
      }
    });
  }

  public async search(prompt?: string, command?: string) {
    this._prompt = prompt;
    if (!prompt) {
      prompt = "";
    }

    // Check if the ChatGPTAPI instance is defined
    if (!this._chatGPTAPI) {
      this._newAPI();
    }

    // focus gpt activity from activity bar
    if (!this._view) {
      await vscode.commands.executeCommand("chatgpt.chatView.focus");
    } else {
      this._view?.show?.(true);
    }

    let response = "";
    this._response = "";
    // Get the selected text of the active editor
    const selection = vscode.window.activeTextEditor?.selection;
    const selectedText =
      vscode.window.activeTextEditor?.document.getText(selection);
    // Get the language id of the selected text of the active editor
    // If a user does not want to append this information to their prompt, leave it as an empty string
    // const languageId = (this._settings.codeblockWithLanguageId ? vscode.window.activeTextEditor?.document?.languageId : undefined) || "";
    let searchPrompt = "";

    if (selection && selectedText) {
      // If there is a selection, add the prompt and the selected text to the search prompt
      searchPrompt = `${prompt}\n${selectedText}\n`;
    } else {
      // Otherwise, just use the prompt if user typed it
      searchPrompt = prompt;
    }
    // let promptTemplate = `<|system|>\n<|end|>\n<|user|>\n${searchPrompt}<|end|>\n<|assistant|>`;
    // this._fullPrompt = promptTemplate;
    this._fullPrompt = `${searchPrompt}`;

    // Increment the message number
    this._currentMessageNumber++;
    let currentMessageNumber = this._currentMessageNumber;

    if (!this._chatGPTAPI) {
      response =
        '[ERROR] "API key or API urls are not set or wrong, please go to extension settings to set it (read README.md for more info)"';
    } else {
      // If successfully signed in
      console.log("sendMessage");
      console.log("set prompt", this._prompt);
      // Make sure the prompt is shown
      this._view?.webview.postMessage({
        type: "setPrompt",
        value: this._prompt,
      });
      this._view?.webview.postMessage({ type: "addResponse", value: "..." });

      const agent = this._chatGPTAPI;

      const endpointToUse = command
        ? this._getOperationEndpoint(command)
        : BASE_URL;
      console.log("sending to " + endpointToUse);

      let tempResponse = "";
      // HFInference
      // let hfTextAsyncGenerator = this._chatGPTAPI.textGenerationStream(
      //     {
      //       model: endpointToUse,
      //       inputs: this._fullPrompt,
      //       parameters: {
      //         max_new_tokens: this._settings.maxNewTokens,
      //         temperature: this._settings.temperature,
      //         top_k: this._settings.topK,
      //         top_p: this._settings.topP,
      //       },
      //     },
      //     { fetch: fetch }
      //   );

      //   while (true) {
      //     try {
      //       let { value: output, done } = await hfTextAsyncGenerator.next();
      //       if (this._view && this._view.visible) {
      //         if (output.token.text === "<|end|>") {
      //           break;
      //         }
      //         tempResponse += output.token.text;
      //         this._view?.webview.postMessage({
      //           type: "addResponse",
      //           value: tempResponse,
      //         });
      //       }
      //       if (done) break;
      //     } catch (e: any) {
      //       if (this._currentMessageNumber === currentMessageNumber) {
      //         response = this._response;
      //         response += `\n\n---\n[ERROR] ${e}`;
      //       }
      //       break;
      //     }
      //   }

      // Local Stream Inference
      const streamGenerator = streamInference(this._fullPrompt, endpointToUse);

      while (true) {
        try {
          let { value: output, done } = await streamGenerator.next();

          if (done) {
            break;
          }

          if (this._view && this._view.visible) {
            tempResponse += output;
            this._view?.webview.postMessage({
              type: "addResponse",
              value: tempResponse,
            });
          }
        } catch (e: any) {
          if (this._currentMessageNumber === currentMessageNumber) {
            response = this._response;
            response += `\n\n---\n[ERROR] ${e}`;
          }
          break;
        }
      }
      response = tempResponse;
    }

    if (this._currentMessageNumber !== currentMessageNumber) {
      return;
    }

    // Saves the response
    this._response = response;

    // Show the view and send a message to the webview with the response
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({ type: "addResponse", value: response });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );
    const microlightUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "microlight.min.js"
      )
    );
    const tailwindUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "showdown.min.js"
      )
    );
    const showdownUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "tailwind.min.js"
      )
    );

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<script src="${tailwindUri}"></script>
				<script src="${showdownUri}"></script>
				<script src="${microlightUri}"></script>
				<style>
				.code {
					white-space: pre;
				}
				p {
					padding-top: 0.3rem;
					padding-bottom: 0.3rem;
				}
				/* overrides vscodes style reset, displays as if inside web browser */
				ul, ol {
					list-style: initial !important;
					margin-left: 10px !important;
				}
				h1, h2, h3, h4, h5, h6 {
					font-weight: bold !important;
				}
				</style>
			</head>
			<body>
				<input class="h-10 w-full text-white bg-stone-700 p-4 text-sm" placeholder="Ask Starchat something" id="prompt-input" readonly/>
				
				<div id="response" class="pt-4 text-sm">
				</div>

				<script src="${scriptUri}"></script>
			</body>
			</html>`;
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
