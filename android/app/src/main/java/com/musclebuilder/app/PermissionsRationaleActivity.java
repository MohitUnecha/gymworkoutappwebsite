package com.musclebuilder.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class PermissionsRationaleActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int padding = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20, getResources().getDisplayMetrics());

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        scroll.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("Why MuscleBuilder asks for Health Connect");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setPadding(0, 0, 0, padding / 2);
        root.addView(title);

        TextView body = new TextView(this);
        body.setText(
            "MuscleBuilder reads workouts, heart rate, steps, and body weight so your device data can sync into recovery, calorie, and training analytics. " +
            "We only use the data to power app features and you can disconnect access at any time."
        );
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        body.setPadding(0, 0, 0, padding);
        root.addView(body);

        Button policy = new Button(this);
        policy.setText("Open Privacy Policy");
        policy.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://musclebuilder.app/privacy"))));
        root.addView(policy);

        Button done = new Button(this);
        done.setText("Done");
        done.setOnClickListener(v -> finish());
        root.addView(done);

        setContentView(scroll);
    }
}
