package com.musclebuilder.app;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class CoachSuggestionEngine {
  public static final class ExerciseSummary {
    public final String name;
    public final int sets;
    public final String pattern;
    public final String primaryMuscle;
    public final boolean compound;

    public ExerciseSummary(String name, int sets, String pattern, String primaryMuscle, boolean compound) {
      this.name = name;
      this.sets = sets;
      this.pattern = pattern;
      this.primaryMuscle = primaryMuscle;
      this.compound = compound;
    }
  }

  public static final class DaySummary {
    public final String name;
    public final String type;
    public final List<ExerciseSummary> exercises;

    public DaySummary(String name, String type, List<ExerciseSummary> exercises) {
      this.name = name;
      this.type = type;
      this.exercises = exercises;
    }
  }

  public static final class Suggestion {
    public final String title;
    public final String plain;
    public final String prompt;
    public final List<String> terms;

    public Suggestion(String title, String plain, String prompt, List<String> terms) {
      this.title = title;
      this.plain = plain;
      this.prompt = prompt;
      this.terms = terms;
    }
  }

  private CoachSuggestionEngine() {}

  public static List<Suggestion> suggestionsFor(List<DaySummary> days) {
    List<Suggestion> results = new ArrayList<>();
    if (days == null || days.isEmpty()) {
      results.add(new Suggestion(
        "Start with a simple split",
        "You do not have a plan yet. Start with 3 or 4 training days so the coach can balance your week for you.",
        "Create me a simple 4 day split with balanced push, pull, legs, and recovery.",
        list("split", "balance")
      ));
      return results;
    }

    for (DaySummary day : days) {
      if ("rest".equals(day.type)) continue;

      Map<String, Integer> names = new HashMap<>();
      Map<String, Integer> patterns = new HashMap<>();
      Map<String, Integer> muscles = new HashMap<>();
      int compoundCount = 0;
      int isolationCount = 0;

      for (ExerciseSummary ex : day.exercises) {
        String key = ex.name.trim().toLowerCase();
        names.put(key, names.getOrDefault(key, 0) + 1);
        patterns.put(ex.pattern, patterns.getOrDefault(ex.pattern, 0) + 1);
        muscles.put(ex.primaryMuscle, muscles.getOrDefault(ex.primaryMuscle, 0) + ex.sets);
        if (ex.compound) compoundCount++; else isolationCount++;
      }

      for (Map.Entry<String, Integer> entry : names.entrySet()) {
        if (entry.getValue() > 1) {
          results.add(new Suggestion(
            "Combine duplicate exercises",
            day.name + " repeats " + entry.getKey() + ". Keep one line and add the sets together so the workout is easier to follow.",
            "Explain in plain language why I should combine duplicate " + entry.getKey() + " entries on " + day.name + ".",
            list("overlap", "volume")
          ));
          break;
        }
      }

      Map.Entry<String, Integer> overloaded = null;
      for (Map.Entry<String, Integer> entry : muscles.entrySet()) {
        if (overloaded == null || entry.getValue() > overloaded.getValue()) overloaded = entry;
      }
      if (overloaded != null && overloaded.getValue() >= 16) {
        results.add(new Suggestion(
          "This day may be too crowded",
          day.name + " puts " + overloaded.getValue() + " sets on " + overloaded.getKey() + ". Spread part of that work to another day so performance stays higher.",
          "Rewrite " + day.name + " so " + overloaded.getKey().toLowerCase() + " is not overloaded in one session.",
          list("volume", "recovery")
        ));
      }

      for (Map.Entry<String, Integer> entry : patterns.entrySet()) {
        if (entry.getValue() >= 3 && !"unknown".equals(entry.getKey())) {
          results.add(new Suggestion(
            "Too many similar movement angles",
            day.name + " repeats the " + entry.getKey() + " pattern a lot. Swap one exercise so the day trains more than one angle.",
            "Suggest one better replacement for a repeated " + entry.getKey() + " exercise on " + day.name + ".",
            list("overlap", "balance")
          ));
          break;
        }
      }

      if (isolationCount >= 4 && compoundCount <= 1) {
        results.add(new Suggestion(
          "This day needs a stronger base lift",
          day.name + " leans heavily on smaller isolation work. Start with 1 or 2 compound lifts so the session is more efficient.",
          "Improve " + day.name + " by adding better compound exercises first and keeping it simple.",
          list("balance", "volume")
        ));
      }
    }

    return results.size() > 5 ? results.subList(0, 5) : results;
  }

  private static List<String> list(String... values) {
    List<String> out = new ArrayList<>();
    for (String value : values) out.add(value);
    return out;
  }
}
