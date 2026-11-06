import java.util.Properties

plugins {
    id("com.android.application")
}

// The release signing key: android/signing/ (not in the repository; keep a backup of it).
// Every update must be signed with the same key, or Android refuses to install it.
val signing = Properties().apply {
    val file = rootProject.file("signing/signing.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.mapleonlinesolutions.iptv"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.mapleonlinesolutions.iptv"
        minSdk = 24
        targetSdk = 35
        versionCode = 7
        versionName = "1.2.1"
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file("signing/" + signing.getProperty("storeFile"))
                storePassword = signing.getProperty("password")
                keyAlias = signing.getProperty("alias")
                keyPassword = signing.getProperty("password")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The TV interface is shared with the Samsung (Tizen) build, so it is
    // packaged straight from the top-level web/ folder.
    sourceSets {
        getByName("main") {
            assets.directories.add("../../web")
        }
    }
}

dependencies {
    val media3 = "1.11.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.activity:activity:1.13.0")
    implementation("com.android.billingclient:billing:9.1.0")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.1")
}
