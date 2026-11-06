plugins {
    id("com.android.application")
}

android {
    namespace = "com.mapleonlinesolutions.iptv"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.mapleonlinesolutions.iptv"
        minSdk = 24
        targetSdk = 35
        versionCode = 6
        versionName = "1.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
