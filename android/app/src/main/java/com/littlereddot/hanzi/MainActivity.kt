package com.littlereddot.hanzi

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
  private lateinit var webView: WebView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)

    webView = findViewById(R.id.web_view)
    val assetLoader = WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
      .build()
    configureWebView(assetLoader)

    val restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null
    if (!restored) webView.loadUrl(START_URL)
  }

  @Suppress("DEPRECATION")
  private fun configureWebView(assetLoader: WebViewAssetLoader) {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    webView.setBackgroundColor(Color.rgb(234, 242, 248))
    webView.webChromeClient = WebChromeClient()
    webView.webViewClient = LocalContentClient(assetLoader)

    with(webView.settings) {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      mediaPlaybackRequiresUserGesture = true
      builtInZoomControls = false
      displayZoomControls = false
      cacheMode = WebSettings.LOAD_DEFAULT
      defaultTextEncodingName = "utf-8"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
        allowFileAccessFromFileURLs = false
        allowUniversalAccessFromFileURLs = false
      }
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    webView.saveState(outState)
    super.onSaveInstanceState(outState)
  }

  override fun onPause() {
    webView.onPause()
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    webView.onResume()
  }

  @Deprecated("Android 12 and lower back navigation")
  override fun onBackPressed() {
    if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
  }

  override fun onDestroy() {
    webView.stopLoading()
    webView.loadUrl("about:blank")
    webView.removeAllViews()
    webView.destroy()
    super.onDestroy()
  }

  private inner class LocalContentClient(
    private val assetLoader: WebViewAssetLoader
  ) : WebViewClient() {
    override fun shouldInterceptRequest(
      view: WebView,
      request: WebResourceRequest
    ) = assetLoader.shouldInterceptRequest(request.url)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      return handleNavigation(request.url)
    }

    @Deprecated("Used on Android 6")
    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
      return handleNavigation(Uri.parse(url))
    }

    private fun handleNavigation(uri: Uri): Boolean {
      val target = uri.toString()
      if (target.startsWith(LOCAL_ASSET_PREFIX) || target == "about:blank") return false

      return try {
        startActivity(Intent(Intent.ACTION_VIEW, uri))
        true
      } catch (_: ActivityNotFoundException) {
        true
      }
    }
  }

  private companion object {
    const val LOCAL_ASSET_PREFIX = "https://appassets.androidplatform.net/assets/web/"
    const val START_URL = "https://appassets.androidplatform.net/assets/web/index.html"
  }
}
