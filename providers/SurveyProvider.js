export class SurveyProvider {
  /**
   * Initializes the provider
   */
  start() {
    throw new Error("Method 'start()' must be implemented.");
  }

  /**
   * Stops the provider polling
   */
  stop() {
    throw new Error("Method 'stop()' must be implemented.");
  }

  /**
   * Main polling function
   */
  async poll() {
    throw new Error("Method 'poll()' must be implemented.");
  }

  /**
   * Parses the raw API response into standard Survey events
   * @param {any} rawResponse 
   */
  parseResponse(rawResponse) {
    throw new Error("Method 'parseResponse()' must be implemented.");
  }

  /**
   * Main wrapper that handles fetching and parsing
   */
  async detectNewSurveys() {
    const rawData = await this.poll();
    return this.parseResponse(rawData);
  }
}
