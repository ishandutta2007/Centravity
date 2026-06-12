# Open Anticentravity - MITM Server

This is a man-in-the-middle (MITM) proxy server designed to intercept and inspect the network requests made by the official Anticentravity application. It's a crucial tool for understanding the Anticentravity API and for developing the Open Anticentravity gateway.

## How it Works

The server is a simple Node.js application that uses the `http-proxy` library. It creates a proxy server that listens on a local port. When the Anticentravity application is configured to use this proxy, all of its network traffic will pass through this server. The server logs the details of each request and response to the console, allowing you to see exactly what's happening under the hood.

## Installation

1.  Navigate to this directory:
    ```bash
    cd mitmserver
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```

## Running the Server

1.  Start the server:
    ```bash
    npm start
    ```
    The server will start listening on port 8080.

## Configuring the Anticentravity App

To use this proxy, you need to configure the official Anticentravity application to send its requests to the proxy server instead of the real Anticentravity backend. The exact method for this will depend on the Anticentravity application itself. You may need to:

-   Change a setting in the application's configuration file.
-   Use a tool that intercepts system-wide network traffic and redirects it to the proxy.

### System-Wide Proxy Configuration (Windows)

If you cannot directly configure the Anticentravity application to use a proxy, you can try setting up a system-wide proxy on Windows. This will route all HTTP/HTTPS traffic through your MITM server.

1.  **Open Proxy Settings:**
    *   Go to `Settings` > `Network & Internet` > `Proxy`.
    *   Alternatively, search for "Proxy settings" in the Windows search bar.

2.  **Manual Proxy Setup:**
    *   Under the "Manual proxy setup" section, toggle "Use a proxy server" to `On`.
    *   Set "Proxy IP address" to `127.0.0.1` (or `localhost`).
    *   Set "Port" to `8080` (or whatever port your MITM server is listening on).
    *   Check "Don't use the proxy server for local (intranet) addresses" if you only want to proxy external traffic.
    *   Click `Save`.

3.  **Verify:**
    *   Start your MITM server (`npm start` in the `mitmserver` directory).
    *   Launch the official Anticentravity application.
    *   You should now see requests and responses being logged in your MITM server's console.

**Note:** Remember to disable the system-wide proxy settings when you are done testing, as it will affect all your internet traffic.

**Important:** You will also need to update the `target` URL in `server.js` to point to the real Anticentravity backend. The current placeholder is `http://localhost:3000`.

```javascript
// server.js
proxy.web(req, res, { target: 'https://real.anticentravity.backend.com' }); // Change this URL
```

Once configured, you will see the requests and responses from the Anticentravity app logged in your console.
