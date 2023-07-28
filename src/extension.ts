import * as vscode from "vscode";
import { WingmanInference } from "./inferences/wingmanInference";
import { PromptType } from "./enums";

type AuthInfo = { apiKey?: string };

type Settings = {
  apiUrl?: string;
};

export function activate(context: vscode.ExtensionContext) {
  console.log('activating extension "Wingman"');
  // Get the settings from the extension's configuration
  const config = vscode.workspace.getConfiguration("wingman");

  // Create a new TextGenerationViewProvider instance and register it with the extension's context
  const provider = new TextGenerationViewProvider(context.extensionUri);

  // Put configuration settings into the provider
  provider.setAuthenticationInfo({
    apiKey: config.get("apiKey") || "",
  });
  provider.setSettings({
    apiUrl: config.get("apiUrl") || "",
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

  const commandHandler = (promptType: string) => {
    provider.chat(promptType);
  };

  // Register the commands that can be called from the extension's package.json
  context.subscriptions.push(
    vscode.commands.registerCommand("chatgpt.explain", () =>
      commandHandler(PromptType.Explain)
    ),
    vscode.commands.registerCommand("chatgpt.refactor", () =>
      commandHandler(PromptType.Refactor)
    ),
    vscode.commands.registerCommand("chatgpt.optimize", () =>
      commandHandler(PromptType.Optimize)
    ),
    vscode.commands.registerCommand("chatgpt.findProblems", () =>
      commandHandler(PromptType.FindProblems)
    ),
    vscode.commands.registerCommand("chatgpt.documentation", () =>
      commandHandler(PromptType.WriteDocumentation)
    )
  );

  // Change the extension's session token or settings when configuration is changed
  vscode.workspace.onDidChangeConfiguration(
    (event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("wingman.apiKey")) {
        const config = vscode.workspace.getConfiguration("wingman");
        provider.setAuthenticationInfo({ apiKey: config.get("apiKey") });
      } else if (event.affectsConfiguration("wingman.apiUrl")) {
        const config = vscode.workspace.getConfiguration("wingman");
        let url = config.get("apiUrl") as string;
        provider.setSettings({ apiUrl: url });
      }
    }
  );
}

class TextGenerationViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "chatgpt.chatView";
  private _view?: vscode.WebviewView;
  private _wingmanInferenceAPI?: WingmanInference;

  private _response?: string;
  private _input?: string;
  private _currentMessageNumber = 0;

  private _settings?: Settings;

  private _authInfo?: AuthInfo;

  // In the constructor, we store the URI of the extension
  constructor(private readonly _extensionUri: vscode.Uri) {}

  // Set the API key
  public setAuthenticationInfo(authInfo: AuthInfo) {
    this._authInfo = { ...this._authInfo, ...authInfo };
  }

  // Set the setting and create a new API instance based on this settings options
  public setSettings(settings: Settings) {
    this._settings = { ...this._settings, ...settings };
    this._newAPI();
  }

  public getSettings() {
    return this._settings;
  }

  // This private method initializes a new Inference instance
  private _newAPI() {
    if (!this._settings?.apiUrl) {
      this._wingmanInferenceAPI = undefined;
    } else {
      this._wingmanInferenceAPI = new WingmanInference(
        this._authInfo?.apiKey || "",
        this._settings?.apiUrl || ""
      );
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
        case "codeSelected":
          let code = data.value;
          const snippet = new vscode.SnippetString();
          snippet.appendText(code);
          // insert the code as a snippet into the active text editor
          vscode.window.activeTextEditor?.insertSnippet(snippet);
          break;
        case "prompt":
          this.chat(PromptType.Chat, data.value);
          break;
      }
    });
  }

  public async chat(promptType: string, prompt?: string) {
    this._input = "";

    // Check if the WingmanAPI instance is defined
    if (!this._wingmanInferenceAPI) {
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

    if (prompt) {
      // this must be coming from the prompt-input when `prompt` is supplied
      this._input = `${prompt}`;
    } else if (selection && selectedText) {
      // If there is a selection, set the selected text as the _input
      this._input = `${selectedText}`;
    } else {
      // throw an error
    }

    // Increment the message number
    this._currentMessageNumber++;
    let currentMessageNumber = this._currentMessageNumber;

    if (!this._wingmanInferenceAPI) {
      response =
        "[ERROR 😕] Wingman Inference API URL is not set. Please go to extension settings (read README.md for more info)";
    } else {
      // If successfully signed in
      console.log("sending to " + this._wingmanInferenceAPI?.endpoint);

      this._view?.webview.postMessage({ type: "addResponse", value: "..." });

      let tempResponse = "";

      // Wingman Stream Inference
      const streamGenerator = this._wingmanInferenceAPI?.textGenerationStream(
        this._input,
        promptType
      );

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
          if (e) {
            tempResponse = "[ERROR 😕] Something went wrong";
          } else if (this._currentMessageNumber === currentMessageNumber) {
            tempResponse = this._response;
            tempResponse += `\n\n---\n[ERROR] ${e}`;
          }

          break;
        }
      }
      response = tempResponse;
    }

    // if (this._currentMessageNumber !== currentMessageNumber) {
    //   return;
    // }

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
        <input class="h-10 w-full text-white bg-stone-700 p-4 text-sm" placeholder="Ask Wingman something" id="prompt-input" />

				<div id="response" class="pt-4 text-sm">
				</div>

				<script src="${scriptUri}"></script>
			</body>
			</html>`;
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
