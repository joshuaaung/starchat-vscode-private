import axios from "axios";

export class WingmanInference {
  private _accessToken: string;
  private _endpoint: string;
  private _maxNewTokens: number = 1024;
  private _isStreamingResponse: boolean = true;
  private _stopSequences: Array<string> = ["<|end|>"];

  constructor(accessToken: string, endpoint: string) {
    this._accessToken = accessToken;
    this._endpoint = endpoint;
  }

  public get accessToken() {
    return this._accessToken;
  }

  public get endpoint() {
    return this._endpoint;
  }

  public set accessToken(accessToken: string) {
    this._accessToken = accessToken;
  }

  public set endpoint(endpoint: string) {
    this._endpoint = endpoint;
  }

  async *textGenerationStream(
    prompt: string,
    promptType: string
  ): AsyncGenerator<string> {
    try {
      const payload: any = {
        inputs: prompt,
        parameters: {
          max_new_tokens: this._maxNewTokens,
          stop_sequences: this._stopSequences,
        },
        prompt_type: promptType,
      };

      const response = await axios.post(this._endpoint, payload, {
        responseType: "stream",
      });

      const stream = response.data;

      for await (const chunk of stream) {
        yield chunk.toString();
        //   textResponse += chunk.toString();

        //   // Check if a complete response has been received
        //   if (textResponse.includes("\n")) {
        //     const responses = textResponse.split("\n");

        //     // Yield each response, except the last one (incomplete)
        //     for (let i = 0; i < responses.length - 1; i++) {
        //       const response = responses[i];
        //       yield response;
        //     }

        //     // Store the last incomplete response for the next iteration
        //     textResponse = responses[responses.length - 1];
        //   }
      }

      // Yield the last remaining response
      // if (textResponse) {
      //   yield textResponse;
      // }

      console.log("Stream done");
    } catch (error) {
      console.warn(error);
      throw error;
    }
  }
}
