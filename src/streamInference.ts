import axios from "axios";

async function* streamInference(prompt: string): AsyncGenerator<string> {
  const endpoint = "http://localhost:8100/code/explain";

  try {
    const response = await axios.post(
      endpoint,
      {
        code: prompt,
      },
      {
        responseType: "stream",
      }
    );

    const stream = response.data;
    let textResponse = "";

    for await (const chunk of stream) {
      textResponse += chunk.toString();

      // Check if a complete response has been received
      if (textResponse.includes("\n")) {
        const responses = textResponse.split("\n");

        // Yield each response, except the last one (incomplete)
        for (let i = 0; i < responses.length - 1; i++) {
          const response = responses[i];
          yield response;
        }

        // Store the last incomplete response for the next iteration
        textResponse = responses[responses.length - 1];
      }
    }

    // Yield the last remaining response
    if (textResponse) {
      yield textResponse;
    }

    console.log("Stream done");
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

export default streamInference;
